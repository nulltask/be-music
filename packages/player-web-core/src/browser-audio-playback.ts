import { isPlayableChannel, isPlayLaneSoundChannel } from '../../chart/src/index.ts';
import { normalizeObjectKey, type BeMusicEvent, type BeMusicJson } from '../../json/src/index.ts';
import { collectBrowserSampleTriggers, type BrowserTimedSampleTrigger } from './browser-sample-triggers.ts';
import { createBrowserSourceFileLookup, resolveBrowserSampleFile, type BrowserSourceFileLookup } from './browser-sample-path.ts';
import type { BrowserSongAssetSource } from './types.ts';

const DEFAULT_OUTPUT_GAIN = 0.9;
const DEFAULT_START_LEAD_SECONDS = 0.05;
const DECODE_CONCURRENCY = 4;
const SCHEDULE_LOOKAHEAD_SECONDS = 0.2;
const MIN_START_AHEAD_SECONDS = 0.01;

export interface BrowserAudioContextFactory {
  (): BrowserAudioContextLike;
}

export interface BrowserDecodedAudioBuffer {
  duration: number;
}

export interface BrowserAudioDestinationLike {}

export interface BrowserAudioBufferSourceNodeLike {
  buffer: BrowserDecodedAudioBuffer | null;
  loop?: boolean;
  connect: (...args: any[]) => unknown;
  start: (when: number, offset?: number, duration?: number) => void;
  stop?: (when?: number) => void;
}

export interface BrowserAudioGainNodeLike {
  gain: {
    value: number;
  };
  connect: (...args: any[]) => unknown;
}

export interface BrowserAudioContextLike {
  currentTime: number;
  state: string;
  destination: BrowserAudioDestinationLike;
  decodeAudioData: (audioData: ArrayBuffer) => Promise<BrowserDecodedAudioBuffer>;
  createBufferSource: () => BrowserAudioBufferSourceNodeLike;
  createGain: () => BrowserAudioGainNodeLike;
  resume: () => Promise<void>;
  suspend: () => Promise<void>;
  close: () => Promise<void>;
}

export interface BrowserAudioPlaybackOptions {
  createAudioContext?: BrowserAudioContextFactory;
  outputGain?: number;
  startLeadSeconds?: number;
  timelineStartSeconds?: number;
  mode?: 'autoplay' | 'manual';
}

export interface BrowserAudioPreparationProgress {
  decodedSampleCount: number;
  totalSampleCount: number;
}

export interface BrowserAudioPreparationResult {
  status: 'ready' | 'silent' | 'unsupported';
  triggerCount: number;
  scheduledTriggerCount: number;
  totalSampleCount: number;
  decodedSampleCount: number;
  missingSampleCount: number;
  failedDecodeCount: number;
}

interface ResolvedBrowserSampleTrigger extends BrowserTimedSampleTrigger {
  resolvedPath: string;
}

interface PendingBrowserTrigger {
  trigger: ResolvedBrowserSampleTrigger;
}

export class BrowserAudioPlayback {
  private readonly json: BeMusicJson;
  private readonly source: BrowserSongAssetSource;
  private readonly chartPath: string;
  private readonly options: BrowserAudioPlaybackOptions;
  private readonly triggers: BrowserTimedSampleTrigger[];
  private fileLookup: BrowserSourceFileLookup | undefined;
  private context: BrowserAudioContextLike | undefined;
  private outputNode: BrowserAudioGainNodeLike | undefined;
  private preparation: BrowserAudioPreparationResult | undefined;
  private resolvedTriggers: ResolvedBrowserSampleTrigger[] = [];
  private scheduledTriggers: ResolvedBrowserSampleTrigger[] = [];
  private resolvedTriggerByEvent = new Map<BeMusicEvent, ResolvedBrowserSampleTrigger>();
  private pendingTriggers: PendingBrowserTrigger[] = [];
  private decodedBuffers = new Map<string, BrowserDecodedAudioBuffer>();
  private failedPaths = new Set<string>();
  private latestBmsSourceNodeBySampleKey = new Map<string, BrowserAudioBufferSourceNodeLike>();
  private scheduledBmsonSlices = new Set<string>();
  private backgroundDecodePromise: Promise<void> | undefined;
  private backgroundDecodeProgress:
    | {
        decodedSampleCount: number;
        totalSampleCount: number;
      }
    | undefined;
  private progressCallback: ((progress: BrowserAudioPreparationProgress) => void) | undefined;
  private sessionStartContextTime = 0;
  private upcomingTriggerIndex = 0;
  private started = false;

  public constructor(
    json: BeMusicJson,
    source: BrowserSongAssetSource,
    chartPath: string,
    options: BrowserAudioPlaybackOptions = {},
  ) {
    this.json = json;
    this.source = source;
    this.chartPath = chartPath;
    this.options = options;
    this.triggers = collectBrowserSampleTriggers(json, undefined, {
      inferBmsLnTypeWhenMissing: true,
    });
  }

  public async prepare(
    onProgress?: (progress: BrowserAudioPreparationProgress) => void,
  ): Promise<BrowserAudioPreparationResult> {
    if (this.preparation) {
      return this.preparation;
    }

    const context = this.createAudioContext();
    if (!context) {
      this.preparation = {
        status: 'unsupported',
        triggerCount: this.triggers.length,
        scheduledTriggerCount: 0,
        totalSampleCount: 0,
        decodedSampleCount: 0,
        missingSampleCount: 0,
        failedDecodeCount: 0,
      };
      return this.preparation;
    }

    this.progressCallback = onProgress;
    this.context = context;
    this.outputNode = context.createGain();
    this.outputNode.gain.value = resolveChartOutputGain(this.json, this.options.outputGain ?? DEFAULT_OUTPUT_GAIN);
    this.outputNode.connect(context.destination);
    await context.resume();

    const fileLookup = createBrowserSourceFileLookup(this.source.files);
    this.fileLookup = fileLookup;
    let missingSampleCount = 0;
    const resolvedTriggers: ResolvedBrowserSampleTrigger[] = [];
    const scheduledTriggers: ResolvedBrowserSampleTrigger[] = [];
    const firstTriggerSecondsByPath = new Map<string, number>();
    const sampleBytesByPath = new Map<string, Uint8Array>();

    for (const trigger of this.triggers) {
      if (!trigger.samplePath) {
        missingSampleCount += 1;
        continue;
      }
      const resolved = resolveBrowserSampleFile(fileLookup, this.chartPath, trigger.samplePath);
      if (!resolved) {
        missingSampleCount += 1;
        continue;
      }
      const resolvedTrigger = {
        ...trigger,
        resolvedPath: resolved.path,
      } satisfies ResolvedBrowserSampleTrigger;
      resolvedTriggers.push(resolvedTrigger);
      this.resolvedTriggerByEvent.set(trigger.event, resolvedTrigger);
      if (shouldAutoScheduleTrigger(trigger.channel, this.options.mode)) {
        scheduledTriggers.push(resolvedTrigger);
      }
      sampleBytesByPath.set(resolved.path, resolved.bytes);
      const previousSeconds = firstTriggerSecondsByPath.get(resolved.path);
      if (previousSeconds === undefined || trigger.seconds < previousSeconds) {
        firstTriggerSecondsByPath.set(resolved.path, trigger.seconds);
      }
    }

    const landmineExplosionPath = this.json.resources.wav['00'];
    if (landmineExplosionPath) {
      const resolvedLandmine = resolveBrowserSampleFile(fileLookup, this.chartPath, landmineExplosionPath);
      if (resolvedLandmine) {
        sampleBytesByPath.set(resolvedLandmine.path, resolvedLandmine.bytes);
        const previousSeconds = firstTriggerSecondsByPath.get(resolvedLandmine.path);
        if (previousSeconds === undefined || previousSeconds > 0) {
          firstTriggerSecondsByPath.set(resolvedLandmine.path, 0);
        }
      }
    }

    resolvedTriggers.sort((left, right) => left.seconds - right.seconds || left.channel.localeCompare(right.channel, 'en'));
    scheduledTriggers.sort((left, right) => left.seconds - right.seconds || left.channel.localeCompare(right.channel, 'en'));
    this.resolvedTriggers = resolvedTriggers;
    this.scheduledTriggers = scheduledTriggers;
    this.pendingTriggers = [];
    this.backgroundDecodeProgress = {
      decodedSampleCount: 0,
      totalSampleCount: sampleBytesByPath.size,
    };

    this.preparation = {
      status: resolvedTriggers.length > 0 ? 'ready' : 'silent',
      triggerCount: this.triggers.length,
      scheduledTriggerCount: scheduledTriggers.length,
      totalSampleCount: sampleBytesByPath.size,
      decodedSampleCount: 0,
      missingSampleCount,
      failedDecodeCount: 0,
    };

    this.emitProgress();
    this.backgroundDecodePromise = this.decodeSamplesInBackground(
      [...sampleBytesByPath.entries()].sort(
        (left, right) => (firstTriggerSecondsByPath.get(left[0]) ?? Number.POSITIVE_INFINITY) - (firstTriggerSecondsByPath.get(right[0]) ?? Number.POSITIVE_INFINITY),
      ),
    );

    return this.preparation;
  }

  public start(): number {
    if (this.started || !this.context || !this.outputNode) {
      return 0;
    }

    this.started = true;
    this.pendingTriggers = [];
    const timelineStartSeconds = resolveTimelineStartSeconds(this.options.timelineStartSeconds);
    this.upcomingTriggerIndex = findFirstIndexAtOrAfter(
      this.scheduledTriggers,
      timelineStartSeconds,
      (trigger) => trigger.seconds,
    );
    this.latestBmsSourceNodeBySampleKey.clear();
    this.scheduledBmsonSlices.clear();
    const leadSeconds = this.options.startLeadSeconds ?? DEFAULT_START_LEAD_SECONDS;
    this.sessionStartContextTime = this.context.currentTime + leadSeconds - timelineStartSeconds;
    this.update(timelineStartSeconds);
    return leadSeconds;
  }

  public update(currentSeconds: number): void {
    if (!this.started || !this.context || !this.outputNode) {
      return;
    }

    const scheduleWindowEnd = Math.max(0, currentSeconds) + SCHEDULE_LOOKAHEAD_SECONDS;
    while (this.upcomingTriggerIndex < this.scheduledTriggers.length) {
      const trigger = this.scheduledTriggers[this.upcomingTriggerIndex]!;
      if (trigger.seconds > scheduleWindowEnd) {
        break;
      }
      this.pendingTriggers.push({ trigger });
      this.upcomingTriggerIndex += 1;
    }

    if (this.pendingTriggers.length === 0) {
      return;
    }

    const remainingPending: PendingBrowserTrigger[] = [];
    for (const pending of this.pendingTriggers) {
      const decodedBuffer = this.decodedBuffers.get(pending.trigger.resolvedPath);
      if (decodedBuffer) {
        this.scheduleTrigger(pending.trigger, decodedBuffer);
        continue;
      }
      if (this.failedPaths.has(pending.trigger.resolvedPath)) {
        continue;
      }
      remainingPending.push(pending);
    }
    this.pendingTriggers = remainingPending;
  }

  public async pause(): Promise<void> {
    if (this.context && this.context.state !== 'suspended') {
      await this.context.suspend();
    }
  }

  public async resume(): Promise<void> {
    if (this.context && this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  public triggerEvent(event: Pick<BeMusicEvent, 'value'> & Partial<Pick<BeMusicEvent, 'channel'>>): void {
    const resolvedTrigger = this.resolvedTriggerByEvent.get(event as BeMusicEvent);
    if (resolvedTrigger) {
      this.triggerResolvedTriggerNow(resolvedTrigger);
      return;
    }
    this.triggerObjectValue(event.value);
  }

  public triggerObjectValue(value: string): void {
    const sampleKey = normalizeObjectKey(value);
    this.triggerSampleKey(sampleKey);
  }

  public async dispose(): Promise<void> {
    await this.backgroundDecodePromise;
    if (this.context && this.context.state !== 'closed') {
      await this.context.close();
    }
    this.context = undefined;
    this.outputNode = undefined;
    this.fileLookup = undefined;
    this.preparation = undefined;
    this.resolvedTriggers = [];
    this.scheduledTriggers = [];
    this.resolvedTriggerByEvent.clear();
    this.pendingTriggers = [];
    this.decodedBuffers.clear();
    this.failedPaths.clear();
    this.latestBmsSourceNodeBySampleKey.clear();
    this.scheduledBmsonSlices.clear();
    this.backgroundDecodePromise = undefined;
    this.backgroundDecodeProgress = undefined;
    this.progressCallback = undefined;
    this.sessionStartContextTime = 0;
    this.upcomingTriggerIndex = 0;
    this.started = false;
  }

  private scheduleTrigger(trigger: ResolvedBrowserSampleTrigger, buffer: BrowserDecodedAudioBuffer): void {
    if (!this.context || !this.outputNode) {
      return;
    }

    if (this.json.sourceFormat === 'bmson' && trigger.sampleSliceId) {
      const sliceKey = `${trigger.sampleSliceId}@${trigger.seconds.toFixed(6)}`;
      if (this.scheduledBmsonSlices.has(sliceKey)) {
        return;
      }
      this.scheduledBmsonSlices.add(sliceKey);
    }

    const scheduledStartTime = this.sessionStartContextTime + trigger.seconds;
    const minStartTime = this.context.currentTime + MIN_START_AHEAD_SECONDS;
    const lateSeconds = Math.max(0, minStartTime - scheduledStartTime);
    const sampleOffsetSeconds = Math.max(0, trigger.sampleOffsetSeconds + lateSeconds);
    const remainingDurationSeconds = resolveRemainingDurationSeconds(
      trigger.sampleDurationSeconds,
      buffer.duration,
      sampleOffsetSeconds,
      lateSeconds,
    );
    if (remainingDurationSeconds !== undefined && remainingDurationSeconds <= 0) {
      return;
    }
    if (sampleOffsetSeconds >= buffer.duration) {
      return;
    }

    const sourceNode = this.context.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.connect(this.outputNode);

    const startTime = Math.max(scheduledStartTime, minStartTime);
    if (typeof remainingDurationSeconds === 'number') {
      sourceNode.start(startTime, sampleOffsetSeconds, remainingDurationSeconds);
    } else {
      sourceNode.start(startTime, sampleOffsetSeconds);
    }

    if (this.json.sourceFormat === 'bms') {
      const previousSourceNode = this.latestBmsSourceNodeBySampleKey.get(trigger.sampleKey);
      if (previousSourceNode?.stop) {
        try {
          previousSourceNode.stop(startTime);
        } catch {
          // Ignore invalid-state errors from already-finished nodes.
        }
      }
      this.latestBmsSourceNodeBySampleKey.set(trigger.sampleKey, sourceNode);
    }
  }

  private triggerResolvedTriggerNow(trigger: ResolvedBrowserSampleTrigger): void {
    const decodedBuffer = this.decodedBuffers.get(trigger.resolvedPath);
    if (!decodedBuffer || !this.context || !this.outputNode) {
      return;
    }
    this.scheduleImmediateSource({
      sampleKey: trigger.sampleKey,
      buffer: decodedBuffer,
      sampleOffsetSeconds: trigger.sampleOffsetSeconds,
      sampleDurationSeconds: trigger.sampleDurationSeconds,
      sampleSliceId: trigger.sampleSliceId,
    });
  }

  private triggerSampleKey(sampleKey: string): void {
    if (!this.fileLookup || !this.context || !this.outputNode) {
      return;
    }
    const samplePath = this.json.resources.wav[sampleKey];
    if (!samplePath) {
      return;
    }
    const resolved = resolveBrowserSampleFile(this.fileLookup, this.chartPath, samplePath);
    if (!resolved) {
      return;
    }
    const decodedBuffer = this.decodedBuffers.get(resolved.path);
    if (!decodedBuffer) {
      return;
    }
    this.scheduleImmediateSource({
      sampleKey,
      buffer: decodedBuffer,
      sampleOffsetSeconds: 0,
    });
  }

  private scheduleImmediateSource(params: {
    sampleKey: string;
    buffer: BrowserDecodedAudioBuffer;
    sampleOffsetSeconds: number;
    sampleDurationSeconds?: number;
    sampleSliceId?: string;
  }): void {
    if (!this.context || !this.outputNode) {
      return;
    }
    if (this.json.sourceFormat === 'bmson' && params.sampleSliceId) {
      const sliceKey = `${params.sampleSliceId}:manual:${this.context.currentTime.toFixed(6)}`;
      if (this.scheduledBmsonSlices.has(sliceKey)) {
        return;
      }
      this.scheduledBmsonSlices.add(sliceKey);
    }
    const sourceNode = this.context.createBufferSource();
    sourceNode.buffer = params.buffer;
    sourceNode.connect(this.outputNode);
    const startTime = this.context.currentTime + MIN_START_AHEAD_SECONDS;
    const remainingDurationSeconds = resolveRemainingDurationSeconds(
      params.sampleDurationSeconds,
      params.buffer.duration,
      params.sampleOffsetSeconds,
      0,
    );
    if (typeof remainingDurationSeconds === 'number') {
      sourceNode.start(startTime, params.sampleOffsetSeconds, remainingDurationSeconds);
    } else {
      sourceNode.start(startTime, params.sampleOffsetSeconds);
    }
    if (this.json.sourceFormat === 'bms') {
      const previousSourceNode = this.latestBmsSourceNodeBySampleKey.get(params.sampleKey);
      if (previousSourceNode?.stop) {
        try {
          previousSourceNode.stop(startTime);
        } catch {
          // Ignore invalid-state errors from already-finished nodes.
        }
      }
      this.latestBmsSourceNodeBySampleKey.set(params.sampleKey, sourceNode);
    }
  }

  private async decodeSamplesInBackground(entries: ReadonlyArray<readonly [string, Uint8Array]>): Promise<void> {
    if (!this.context || entries.length === 0) {
      return;
    }

    let decodedSampleCount = 0;
    await runWithConcurrency(entries, DECODE_CONCURRENCY, async ([path, bytes]) => {
      if (!this.context) {
        return;
      }
      try {
        const decoded = await this.context.decodeAudioData(cloneBytesAsArrayBuffer(bytes));
        this.decodedBuffers.set(path, decoded);
        decodedSampleCount += 1;
      } catch {
        this.failedPaths.add(path);
      }
      if (this.backgroundDecodeProgress) {
        this.backgroundDecodeProgress.decodedSampleCount = decodedSampleCount;
      }
      this.emitProgress();
    });

    if (this.preparation) {
      this.preparation.decodedSampleCount = decodedSampleCount;
      this.preparation.failedDecodeCount = this.failedPaths.size;
    }
  }

  private emitProgress(): void {
    if (!this.progressCallback || !this.backgroundDecodeProgress) {
      return;
    }
    this.progressCallback({
      decodedSampleCount: this.backgroundDecodeProgress.decodedSampleCount,
      totalSampleCount: this.backgroundDecodeProgress.totalSampleCount,
    });
  }

  private createAudioContext(): BrowserAudioContextLike | undefined {
    return this.options.createAudioContext?.() ?? createDefaultAudioContext();
  }
}

function createDefaultAudioContext(): BrowserAudioContextLike | undefined {
  const globalAudio = globalThis as typeof globalThis & {
    AudioContext?: new () => BrowserAudioContextLike;
    webkitAudioContext?: new () => BrowserAudioContextLike;
  };
  const AudioContextConstructor = globalAudio.AudioContext ?? globalAudio.webkitAudioContext;
  return AudioContextConstructor ? new AudioContextConstructor() : undefined;
}

function resolveTimelineStartSeconds(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function shouldAutoScheduleTrigger(channel: string, mode: BrowserAudioPlaybackOptions['mode']): boolean {
  if (mode !== 'manual') {
    return true;
  }
  if (isPlayableChannel(channel)) {
    return false;
  }
  if (isPlayLaneSoundChannel(channel)) {
    return false;
  }
  return true;
}

function resolveChartOutputGain(json: BeMusicJson, baseGain: number): number {
  const volWav = json.bms.volWav;
  const chartGain = typeof volWav === 'number' && Number.isFinite(volWav) && volWav >= 0 ? volWav / 100 : 1;
  return baseGain * chartGain;
}

function resolveRemainingDurationSeconds(
  triggerDurationSeconds: number | undefined,
  bufferDurationSeconds: number,
  sampleOffsetSeconds: number,
  lateSeconds: number,
): number | undefined {
  if (typeof triggerDurationSeconds === 'number' && Number.isFinite(triggerDurationSeconds)) {
    return Math.max(0, triggerDurationSeconds - lateSeconds);
  }
  const remainingBufferSeconds = bufferDurationSeconds - sampleOffsetSeconds;
  return remainingBufferSeconds > 0 ? remainingBufferSeconds : undefined;
}

function cloneBytesAsArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

async function runWithConcurrency<T>(
  items: ReadonlyArray<T>,
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        await task(items[currentIndex]!);
      }
    }),
  );
}

function findFirstIndexAtOrAfter<T>(
  items: ReadonlyArray<T>,
  target: number,
  resolveValue: (item: T) => number,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (resolveValue(items[mid]!) < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}
