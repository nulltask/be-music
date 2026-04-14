import type { BeMusicJson } from '../../json/src/index.ts';
import type { BrowserSongAssetSource } from './types.ts';
import { collectBrowserSampleTriggers, type BrowserTimedSampleTrigger } from './browser-sample-triggers.ts';
import { createBrowserSourceFileLookup, resolveBrowserSampleFile } from './browser-sample-path.ts';
import { createTimingResolver } from './timing.ts';

const DEFAULT_OUTPUT_GAIN = 0.9;
const DEFAULT_START_LEAD_SECONDS = 0.05;

export interface BrowserAudioContextFactory {
  (): BrowserAudioContextLike;
}

export interface BrowserDecodedAudioBuffer {}

export interface BrowserAudioDestinationLike {}

export interface BrowserAudioBufferSourceNodeLike {
  buffer: BrowserDecodedAudioBuffer | null;
  connect: (...args: any[]) => unknown;
  start: (when: number, offset?: number, duration?: number) => void;
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

interface ScheduledBrowserAudioTrigger {
  trigger: BrowserTimedSampleTrigger;
  buffer: BrowserDecodedAudioBuffer;
}

export class BrowserAudioPlayback {
  private readonly json: BeMusicJson;
  private readonly source: BrowserSongAssetSource;
  private readonly chartPath: string;
  private readonly options: BrowserAudioPlaybackOptions;
  private readonly resolver: ReturnType<typeof createTimingResolver>;
  private readonly triggers: BrowserTimedSampleTrigger[];
  private context: BrowserAudioContextLike | undefined;
  private outputNode: BrowserAudioGainNodeLike | undefined;
  private scheduledTriggers: ScheduledBrowserAudioTrigger[] = [];
  private started = false;
  private preparation: BrowserAudioPreparationResult | undefined;

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
    this.resolver = createTimingResolver(json);
    this.triggers = collectBrowserSampleTriggers(json, this.resolver, {
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
    this.context = context;
    this.outputNode = context.createGain();
    this.outputNode.gain.value = resolveChartOutputGain(this.json, this.options.outputGain ?? DEFAULT_OUTPUT_GAIN);
    this.outputNode.connect(context.destination);
    await context.resume();

    const fileLookup = createBrowserSourceFileLookup(this.source.files);
    const resolvedTriggers: Array<BrowserTimedSampleTrigger & { resolvedPath: string; bytes: Uint8Array }> = [];
    let missingSampleCount = 0;

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
      resolvedTriggers.push({
        ...trigger,
        resolvedPath: resolved.path,
        bytes: resolved.bytes,
      });
    }

    const uniqueSamples = new Map<string, Uint8Array>();
    for (const trigger of resolvedTriggers) {
      if (!uniqueSamples.has(trigger.resolvedPath)) {
        uniqueSamples.set(trigger.resolvedPath, trigger.bytes);
      }
    }

    const decodedBuffers = new Map<string, BrowserDecodedAudioBuffer>();
    const failedPaths = new Set<string>();
    const sampleEntries = [...uniqueSamples.entries()];
    let decodedSampleCount = 0;

    await runWithConcurrency(sampleEntries, 4, async ([path, bytes]) => {
      try {
        const decoded = await context.decodeAudioData(cloneBytesAsArrayBuffer(bytes));
        decodedBuffers.set(path, decoded);
        decodedSampleCount += 1;
        onProgress?.({
          decodedSampleCount,
          totalSampleCount: sampleEntries.length,
        });
      } catch {
        failedPaths.add(path);
        onProgress?.({
          decodedSampleCount,
          totalSampleCount: sampleEntries.length,
        });
      }
    });

    this.scheduledTriggers = [];
    for (const trigger of resolvedTriggers) {
      const buffer = decodedBuffers.get(trigger.resolvedPath);
      if (!buffer) {
        continue;
      }
      this.scheduledTriggers.push({
        trigger,
        buffer,
      });
    }

    this.preparation = {
      status: this.scheduledTriggers.length > 0 ? 'ready' : 'silent',
      triggerCount: this.triggers.length,
      scheduledTriggerCount: this.scheduledTriggers.length,
      totalSampleCount: sampleEntries.length,
      decodedSampleCount,
      missingSampleCount,
      failedDecodeCount: failedPaths.size,
    };
    return this.preparation;
  }

  public start(): number {
    if (this.started || !this.context || !this.outputNode || this.scheduledTriggers.length === 0) {
      return 0;
    }
    this.started = true;
    const leadSeconds = this.options.startLeadSeconds ?? DEFAULT_START_LEAD_SECONDS;
    const startAt = this.context.currentTime + leadSeconds;

    for (const { trigger, buffer } of this.scheduledTriggers) {
      const sourceNode = this.context.createBufferSource();
      sourceNode.buffer = buffer;
      sourceNode.connect(this.outputNode);
      if (typeof trigger.sampleDurationSeconds === 'number' && Number.isFinite(trigger.sampleDurationSeconds)) {
        sourceNode.start(startAt + trigger.seconds, trigger.sampleOffsetSeconds, Math.max(0, trigger.sampleDurationSeconds));
      } else {
        sourceNode.start(startAt + trigger.seconds, trigger.sampleOffsetSeconds);
      }
    }

    return leadSeconds;
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

  public async dispose(): Promise<void> {
    if (this.context && this.context.state !== 'closed') {
      await this.context.close();
    }
    this.context = undefined;
    this.outputNode = undefined;
    this.scheduledTriggers = [];
    this.started = false;
    this.preparation = undefined;
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

function resolveChartOutputGain(json: BeMusicJson, baseGain: number): number {
  const volWav = json.bms.volWav;
  const chartGain = typeof volWav === 'number' && Number.isFinite(volWav) && volWav >= 0 ? volWav / 100 : 1;
  return baseGain * chartGain;
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
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      await task(items[currentIndex]!);
    }
  });
  await Promise.all(workers);
}
