import {
  collectBmsExWavVolumeMultipliers,
  collectBmsWavCmdVolumeMultipliers,
  isBmsBgmVolumeChangeChannel,
  isBmsDynamicVolumeChangeChannel,
  isBmsKeyVolumeChangeChannel,
  isPlayLaneSoundChannel,
  parseBmsDynamicVolumeGain,
} from '@be-music/chart';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  normalizeChannel,
  normalizeObjectKey,
  resolveBmsBase,
  type BeMusicEvent,
  type BeMusicJson,
} from '@be-music/json';
import { isAbortError, throwIfAborted } from '@be-music/utils';
import { parseChartFile, resolveBmsControlFlow } from '@be-music/parser';
import { detectAudioFormat, encodeAiff16, encodeWav16 } from './file-codec.ts';
import { createFallbackTone, decodeAudioSample, resampleLinear } from './decode.ts';
import { resolveSamplePath } from './sample-path.ts';
import {
  collectSampleTriggersWithContext,
  createTimingBuildContext,
  createTimingResolverWithContext,
  type TimedSampleTrigger,
  type TimingBuildContext,
  type TimingResolver,
} from './triggers.ts';

export * from './triggers.ts';
export interface RenderOptions {
  sampleRate?: number;
  normalize?: boolean;
  tailSeconds?: number;
  gain?: number;
  startSeconds?: number;
  baseDir?: string;
  fallbackToneSeconds?: number;
  signal?: AbortSignal;
  resolveTriggerGain?: (trigger: TimedSampleTrigger) => number;
  onSampleLoadProgress?: (progress: RenderSampleLoadProgress) => void;
  inferBmsLnTypeWhenMissing?: boolean;
}

export interface RenderSampleLoadProgress {
  stage: 'resolving' | 'reading' | 'decoded' | 'cached' | 'fallback';
  sampleKey: string;
  samplePath?: string;
  resolvedPath?: string;
}

export interface RenderResult {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  durationSeconds: number;
  peak: number;
}

export interface RenderSingleSampleOptions {
  sampleRate?: number;
  gain?: number;
  baseDir?: string;
  fallbackToneSeconds?: number;
  signal?: AbortSignal;
  onSampleLoadProgress?: (progress: RenderSampleLoadProgress) => void;
  /**
   * Object-ID radix the supplied `sampleKey` was authored under. Defaults to base 36 (case-folded). Pass `62` for
   * charts that declared `#BASE 62` so a lowercase `0a` key isn't re-folded back to `0A` during validation.
   */
  base?: 36 | 62;
}

interface StereoSample {
  left: Float32Array;
  right: Float32Array;
}

type DynamicVolumeBus = 'bgm' | 'play';

interface DynamicVolumeChange {
  bus: DynamicVolumeBus;
  seconds: number;
  gain: number;
}

interface DynamicVolumeState {
  index: number;
  gain: number;
}

interface DynamicVolumeChangesByBus {
  bgm: DynamicVolumeChange[];
  play: DynamicVolumeChange[];
}

interface ScheduledSampleRender {
  start: number;
  sample: StereoSample;
  triggerGain: number;
  sampleOffsetFrames: number;
  sampleMaxFrames?: number;
}

interface ScheduledSampleFrameWindow {
  sampleOffsetFrames: number;
  sampleMaxFrames: number;
}

const DEFAULT_SAMPLE_RATE = 44_100;
const DEFAULT_TAIL_SECONDS = 2;
const DEFAULT_GAIN = 0.9;
const FALLBACK_SAMPLE_CACHE = new Map<string, StereoSample>();

function resolveChartVolWavGain(json: BeMusicJson): number {
  const volWav = json.bms.volWav;
  if (typeof volWav !== 'number' || !Number.isFinite(volWav) || volWav < 0) {
    return 1;
  }
  return volWav / 100;
}

function collectDynamicVolumeChanges(
  json: BeMusicJson,
  resolver: TimingResolver,
  context: TimingBuildContext,
): DynamicVolumeChange[] {
  if (json.sourceFormat !== 'bms') {
    return [];
  }
  const changes: DynamicVolumeChange[] = [];
  for (const event of context.sortedEvents) {
    const normalizedChannel = normalizeChannel(event.channel);
    if (!isBmsDynamicVolumeChangeChannel(normalizedChannel)) {
      continue;
    }
    const gain = parseBmsDynamicVolumeGain(event.value);
    if (gain === undefined) {
      continue;
    }
    changes.push({
      bus: isBmsKeyVolumeChangeChannel(normalizedChannel)
        ? 'play'
        : isBmsBgmVolumeChangeChannel(normalizedChannel)
          ? 'bgm'
          : 'play',
      seconds: resolver.eventToSeconds(event),
      gain,
    });
  }
  return changes;
}

function advanceDynamicVolumeGain(
  changes: readonly DynamicVolumeChange[],
  seconds: number,
  state: DynamicVolumeState,
): number {
  while (state.index < changes.length && changes[state.index]!.seconds <= seconds) {
    state.gain = changes[state.index]!.gain;
    state.index += 1;
  }
  return state.gain;
}

export async function renderJson(json: BeMusicJson, options: RenderOptions = {}): Promise<RenderResult> {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const normalize = options.normalize ?? true;
  const tailSeconds = options.tailSeconds ?? DEFAULT_TAIL_SECONDS;
  const gain = (options.gain ?? DEFAULT_GAIN) * resolveChartVolWavGain(json);
  const startSeconds = Number.isFinite(options.startSeconds) ? Math.max(0, options.startSeconds ?? 0) : 0;
  const fallbackToneSeconds = options.fallbackToneSeconds ?? 0.08;
  const baseDir = options.baseDir ?? process.cwd();
  const signal = options.signal;
  const resolveTriggerGain = options.resolveTriggerGain;
  const onSampleLoadProgress = options.onSampleLoadProgress;
  throwIfAborted(signal);

  const timingContext = createTimingBuildContext(json);
  const resolver = createTimingResolverWithContext(json, timingContext);
  const dynamicVolumeChanges = splitDynamicVolumeChangesByBus(
    collectDynamicVolumeChanges(json, resolver, timingContext),
  );
  const triggers = collectSampleTriggersWithContext(json, resolver, timingContext, {
    inferBmsLnTypeWhenMissing: options.inferBmsLnTypeWhenMissing === true,
  });

  const loadedSamples = new Map<string, StereoSample>();
  const resolvedPathCache = new Map<string, string | undefined>();
  const { scheduled, maxFrame } = await scheduleSampleRenders({
    json,
    triggers,
    sampleRate,
    tailSeconds,
    startSeconds,
    baseDir,
    fallbackToneSeconds,
    loadedSamples,
    resolvedPathCache,
    signal,
    onSampleLoadProgress,
    resolveTriggerGain,
    dynamicVolumeChanges,
  });

  const left = new Float32Array(maxFrame);
  const right = new Float32Array(maxFrame);
  mixScheduledSamples(left, right, scheduled, gain, signal);

  const peak = measurePeak(left, right);
  if (normalize && peak > 1) {
    const scale = 1 / peak;
    scalePcm(left, scale);
    scalePcm(right, scale);
  }

  return {
    sampleRate,
    left,
    right,
    durationSeconds: left.length / sampleRate,
    peak: normalize && peak > 1 ? 1 : peak,
  };
}

function splitDynamicVolumeChangesByBus(changes: DynamicVolumeChange[]): DynamicVolumeChangesByBus {
  const partitioned: DynamicVolumeChangesByBus = {
    bgm: [],
    play: [],
  };
  for (const change of changes) {
    partitioned[change.bus].push(change);
  }
  return partitioned;
}

async function scheduleSampleRenders(params: {
  json: BeMusicJson;
  triggers: TimedSampleTrigger[];
  sampleRate: number;
  tailSeconds: number;
  startSeconds: number;
  baseDir: string;
  fallbackToneSeconds: number;
  loadedSamples: Map<string, StereoSample>;
  resolvedPathCache: Map<string, string | undefined>;
  signal?: AbortSignal;
  onSampleLoadProgress?: (progress: RenderSampleLoadProgress) => void;
  resolveTriggerGain?: (trigger: TimedSampleTrigger) => number;
  dynamicVolumeChanges: DynamicVolumeChangesByBus;
}): Promise<{ scheduled: ScheduledSampleRender[]; maxFrame: number }> {
  const {
    json,
    triggers,
    sampleRate,
    tailSeconds,
    startSeconds,
    baseDir,
    fallbackToneSeconds,
    loadedSamples,
    resolvedPathCache,
    signal,
    onSampleLoadProgress,
    resolveTriggerGain,
    dynamicVolumeChanges,
  } = params;
  const scheduled: ScheduledSampleRender[] = [];
  const bmsonScheduledSlices = new Set<string>();
  const latestBmsScheduleBySampleKey = new Map<string, number>();
  const bgmVolumeState: DynamicVolumeState = { index: 0, gain: 1 };
  const playVolumeState: DynamicVolumeState = { index: 0, gain: 1 };
  let maxFrame = Math.max(1, Math.round(tailSeconds * sampleRate));

  // BMS spec — `#PATH_WAV` declares a directory prefix the chart's WAVs live under. The sample-path resolver tries
  // `pathPrefix + samplePath` before the bare path so charts that organise their WAVs under a sub-folder (e.g.
  // `wav/kick.wav` reachable via `#PATH_WAV wav/`) resolve correctly.
  const pathWavPrefix = typeof json.bms.pathWav === 'string' ? json.bms.pathWav : undefined;
  // BMS spec — `#WAVCMD 01 xx vv` declares per-slot volume overrides as a 0..127 byte. Pre-collect into a Map<slotKey,
  // 0..1 multiplier> so the per-trigger lookup is O(1); slots without a `#WAVCMD 01` line stay absent and skip the
  // multiplication. Pitch / loop bytes (`pp = 00` / `02`) are intentionally not collected here — applying them would
  // require resampling / loop-aware mixing that this offline renderer doesn't yet implement.
  const wavCmdVolumeMultipliers = collectBmsWavCmdVolumeMultipliers(json.bms.wavCmds, resolveBmsBase(json));
  // BMS spec — `#EXWAVxx [flags] params filename` extended WAV declarations include an optional `v` (centibel) volume
  // that composes multiplicatively with `#WAVCMD 01 xx vv`. Fold the extracted multipliers into the same Map so the
  // per-trigger gain math stays a single lookup. Pan / freq fall to a future patch since they require resampling /
  // stereo splitting in this offline renderer.
  for (const [slot, multiplier] of collectBmsExWavVolumeMultipliers(json.bms.exWav)) {
    const previous = wavCmdVolumeMultipliers.get(slot) ?? 1;
    wavCmdVolumeMultipliers.set(slot, previous * multiplier);
  }
  for (const trigger of triggers) {
    throwIfAborted(signal);
    const sample = await getOrCreateSample({
      sampleKey: trigger.sampleKey,
      samplePath: trigger.samplePath,
      sampleRate,
      baseDir,
      fallbackToneSeconds,
      loadedSamples,
      resolvedPathCache,
      signal,
      onSampleLoadProgress,
      pathPrefix: pathWavPrefix,
    });
    const frameWindow = resolveScheduledSampleFrameWindow(trigger, sampleRate, sample);
    if (!frameWindow) {
      continue;
    }
    const triggerGain = resolveScheduledTriggerGain(
      trigger,
      resolveTriggerGain,
      dynamicVolumeChanges,
      bgmVolumeState,
      playVolumeState,
      wavCmdVolumeMultipliers,
    );
    const start = Math.max(0, Math.round((trigger.seconds - startSeconds) * sampleRate));

    if (!shouldScheduleTrigger(json, trigger, start, bmsonScheduledSlices)) {
      continue;
    }
    trimPreviousBmsRetrigger(json, trigger, start, scheduled, latestBmsScheduleBySampleKey);

    const scheduleIndex =
      scheduled.push({
        start,
        sample,
        triggerGain,
        sampleOffsetFrames: frameWindow.sampleOffsetFrames,
        sampleMaxFrames: frameWindow.sampleMaxFrames,
      }) - 1;
    if (json.sourceFormat === 'bms') {
      latestBmsScheduleBySampleKey.set(trigger.sampleKey, scheduleIndex);
    }
    if (triggerGain > 0) {
      maxFrame = Math.max(maxFrame, start + frameWindow.sampleMaxFrames + Math.round(tailSeconds * sampleRate));
    }
  }

  return { scheduled, maxFrame };
}

function resolveScheduledSampleFrameWindow(
  trigger: TimedSampleTrigger,
  sampleRate: number,
  sample: StereoSample,
): ScheduledSampleFrameWindow | undefined {
  const sampleOffsetFrames = Math.max(0, Math.round(trigger.sampleOffsetSeconds * sampleRate));
  const availableFrames = sample.left.length - sampleOffsetFrames;
  if (availableFrames <= 0) {
    return undefined;
  }
  const requestedDurationFrames =
    typeof trigger.sampleDurationSeconds === 'number' && Number.isFinite(trigger.sampleDurationSeconds)
      ? Math.max(1, Math.round(trigger.sampleDurationSeconds * sampleRate))
      : undefined;
  const sampleMaxFrames =
    requestedDurationFrames === undefined ? availableFrames : Math.min(availableFrames, requestedDurationFrames);
  if (sampleMaxFrames <= 0) {
    return undefined;
  }
  return { sampleOffsetFrames, sampleMaxFrames };
}

function resolveScheduledTriggerGain(
  trigger: TimedSampleTrigger,
  resolveTriggerGain: ((trigger: TimedSampleTrigger) => number) | undefined,
  dynamicVolumeChanges: DynamicVolumeChangesByBus,
  bgmVolumeState: DynamicVolumeState,
  playVolumeState: DynamicVolumeState,
  wavCmdVolumeMultipliers: ReadonlyMap<string, number>,
): number {
  const rawTriggerGain = resolveTriggerGain?.(trigger) ?? 1;
  const volumeBus: DynamicVolumeBus = isPlayLaneSoundChannel(trigger.channel) ? 'play' : 'bgm';
  const dynamicGain =
    volumeBus === 'play'
      ? advanceDynamicVolumeGain(dynamicVolumeChanges.play, trigger.seconds, playVolumeState)
      : advanceDynamicVolumeGain(dynamicVolumeChanges.bgm, trigger.seconds, bgmVolumeState);
  // `#WAVCMD 01 xx vv` per-slot volume — multiplied in alongside the dynamic-volume bus state so a chart can stack a
  // 50% `#WAVCMD` slot under a `97`/`98` runtime cut.
  const wavCmdGain = wavCmdVolumeMultipliers.get(trigger.sampleKey) ?? 1;
  return (Number.isFinite(rawTriggerGain) ? Math.max(0, rawTriggerGain) : 1) * dynamicGain * wavCmdGain;
}

function shouldScheduleTrigger(
  json: BeMusicJson,
  trigger: TimedSampleTrigger,
  start: number,
  bmsonScheduledSlices: Set<string>,
): boolean {
  if (json.sourceFormat !== 'bmson') {
    return true;
  }
  // bmson 1.0.0 spec: a `c=true` note MUST NOT restart playback — it's a continuation marker that rides on the previous
  // `c=false` anchor's BufferSource. Scheduling a separate render for it would overlap with the still-running anchor
  // sample (especially now that the slice's `durationSeconds` is walked out to the next genuine restart) and
  // effectively double the mix gain at every `c=true` hit. The runtime side achieves the same outcome via its
  // `activeSampleNodes` "skip when already playing" gate; the offline mixer has no such state, so the skip has to
  // happen up front here.
  if (trigger.event.bmson?.c === true) {
    return false;
  }
  if (!trigger.sampleSliceId) {
    return true;
  }
  const dedupeKey = `${trigger.sampleSliceId}@${start}`;
  if (bmsonScheduledSlices.has(dedupeKey)) {
    return false;
  }
  bmsonScheduledSlices.add(dedupeKey);
  return true;
}

function trimPreviousBmsRetrigger(
  json: BeMusicJson,
  trigger: TimedSampleTrigger,
  start: number,
  scheduled: ScheduledSampleRender[],
  latestBmsScheduleBySampleKey: Map<string, number>,
): void {
  if (json.sourceFormat !== 'bms') {
    return;
  }
  const previousIndex = latestBmsScheduleBySampleKey.get(trigger.sampleKey);
  if (previousIndex === undefined) {
    return;
  }
  const previous = scheduled[previousIndex];
  const maxFramesUntilRetrigger = Math.max(0, start - previous.start);
  const currentPreviousMaxFrames =
    previous.sampleMaxFrames ?? previous.sample.left.length - previous.sampleOffsetFrames;
  previous.sampleMaxFrames = Math.min(currentPreviousMaxFrames, maxFramesUntilRetrigger);
}

function mixScheduledSamples(
  destinationLeft: Float32Array,
  destinationRight: Float32Array,
  scheduled: readonly ScheduledSampleRender[],
  gain: number,
  signal?: AbortSignal,
): void {
  for (let scheduleIndex = 0; scheduleIndex < scheduled.length; scheduleIndex += 1) {
    if (signal && (scheduleIndex & 0x1f) === 0) {
      throwIfAborted(signal);
    }
    const item = scheduled[scheduleIndex]!;
    if (item.triggerGain <= 0) {
      continue;
    }
    mixSample(
      destinationLeft,
      destinationRight,
      item.sample,
      item.start,
      gain * item.triggerGain,
      item.sampleOffsetFrames,
      item.sampleMaxFrames,
      signal,
    );
  }
}

export async function renderSingleSample(
  sampleKey: string,
  samplePath: string | undefined,
  options: RenderSingleSampleOptions = {},
): Promise<RenderResult> {
  const normalizedKey = normalizeObjectKey(sampleKey, options.base ?? 36);
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const gain = typeof options.gain === 'number' && Number.isFinite(options.gain) ? options.gain : 1;
  const baseDir = options.baseDir ?? process.cwd();
  const fallbackToneSeconds = options.fallbackToneSeconds ?? 0.08;
  throwIfAborted(options.signal);
  const sample = await getOrCreateSample({
    sampleKey: normalizedKey,
    samplePath,
    sampleRate,
    baseDir,
    fallbackToneSeconds,
    loadedSamples: new Map(),
    resolvedPathCache: new Map(),
    signal: options.signal,
    onSampleLoadProgress: options.onSampleLoadProgress,
  });
  throwIfAborted(options.signal);
  return toRenderResult(sample, sampleRate, gain);
}

export async function renderChartFile(
  inputPath: string,
  outputPath: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const chartPath = resolve(inputPath);
  const json = resolveBmsControlFlow(await parseChartFile(chartPath, { signal: options.signal }));
  const audioRendered = await renderJson(json, {
    ...options,
    baseDir: options.baseDir ?? dirname(chartPath),
  });
  await writeAudioFile(outputPath, audioRendered);
  return audioRendered;
}

export async function writeAudioFile(outputPath: string, result: RenderResult): Promise<void> {
  const destination = resolve(outputPath);
  const format = detectAudioFormat(destination);
  const encoded = format === 'aiff' ? encodeAiff16(result) : encodeWav16(result);
  await writeFile(destination, encoded);
}

async function getOrCreateSample(params: {
  sampleKey: string;
  samplePath?: string;
  sampleRate: number;
  baseDir: string;
  fallbackToneSeconds: number;
  loadedSamples: Map<string, StereoSample>;
  resolvedPathCache: Map<string, string | undefined>;
  signal?: AbortSignal;
  onSampleLoadProgress?: (progress: RenderSampleLoadProgress) => void;
  pathPrefix?: string;
}): Promise<StereoSample> {
  const {
    sampleKey,
    samplePath,
    sampleRate,
    baseDir,
    fallbackToneSeconds,
    loadedSamples,
    resolvedPathCache,
    signal,
    onSampleLoadProgress,
    pathPrefix,
  } = params;
  throwIfAborted(signal);

  const cached = loadedSamples.get(sampleKey);
  if (cached) {
    onSampleLoadProgress?.({
      stage: 'cached',
      sampleKey,
      samplePath,
    });
    return cached;
  }

  const fallback = getFallbackSample(sampleKey, sampleRate, fallbackToneSeconds);
  if (!samplePath) {
    loadedSamples.set(sampleKey, fallback);
    onSampleLoadProgress?.({
      stage: 'fallback',
      sampleKey,
      samplePath,
    });
    return fallback;
  }

  onSampleLoadProgress?.({
    stage: 'resolving',
    sampleKey,
    samplePath,
  });
  // Cache key includes the `#PATH_WAV` prefix so two charts sharing a `baseDir` but different prefixes don't collide.
  const cacheKey = `${baseDir}:${pathPrefix ?? ''}:${samplePath}`;
  const resolvedPath = resolvedPathCache.has(cacheKey)
    ? resolvedPathCache.get(cacheKey)
    : await resolveSamplePath(baseDir, samplePath, signal, { pathPrefix });
  resolvedPathCache.set(cacheKey, resolvedPath);

  if (!resolvedPath) {
    loadedSamples.set(sampleKey, fallback);
    onSampleLoadProgress?.({
      stage: 'fallback',
      sampleKey,
      samplePath,
    });
    return fallback;
  }

  try {
    throwIfAborted(signal);
    onSampleLoadProgress?.({
      stage: 'reading',
      sampleKey,
      samplePath,
      resolvedPath,
    });
    const buffer = await readFile(resolvedPath, { signal });
    throwIfAborted(signal);
    const decoded = await decodeAudioSample(buffer, resolvedPath, signal);
    throwIfAborted(signal);
    const left = resampleLinear(decoded.left, decoded.sampleRate, sampleRate, signal);
    const rightSource = decoded.right ?? decoded.left;
    const right = resampleLinear(rightSource, decoded.sampleRate, sampleRate, signal);
    const sample = { left, right };
    loadedSamples.set(sampleKey, sample);
    onSampleLoadProgress?.({
      stage: 'decoded',
      sampleKey,
      samplePath,
      resolvedPath,
    });
    return sample;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    loadedSamples.set(sampleKey, fallback);
    onSampleLoadProgress?.({
      stage: 'fallback',
      sampleKey,
      samplePath,
      resolvedPath,
    });
    return fallback;
  }
}

function getFallbackSample(sampleKey: string, sampleRate: number, fallbackToneSeconds: number): StereoSample {
  const cacheKey = `${sampleKey}:${sampleRate}:${fallbackToneSeconds}`;
  const cached = FALLBACK_SAMPLE_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }
  const created = createFallbackTone(sampleKey, sampleRate, fallbackToneSeconds);
  FALLBACK_SAMPLE_CACHE.set(cacheKey, created);
  return created;
}

function toRenderResult(sample: StereoSample, sampleRate: number, gain: number): RenderResult {
  const safeGain = Number.isFinite(gain) ? gain : 1;
  if (safeGain === 1) {
    return {
      sampleRate,
      left: sample.left,
      right: sample.right,
      durationSeconds: sample.left.length / sampleRate,
      peak: measurePeak(sample.left, sample.right),
    };
  }

  const left = new Float32Array(sample.left.length);
  const right = new Float32Array(sample.right.length);
  for (let index = 0; index < sample.left.length; index += 1) {
    left[index] = sample.left[index] * safeGain;
    right[index] = sample.right[index] * safeGain;
  }
  return {
    sampleRate,
    left,
    right,
    durationSeconds: left.length / sampleRate,
    peak: measurePeak(left, right),
  };
}

function mixSample(
  destinationLeft: Float32Array,
  destinationRight: Float32Array,
  sample: StereoSample,
  startFrame: number,
  gain: number,
  sampleOffsetFrames = 0,
  sampleMaxFrames?: number,
  signal?: AbortSignal,
): void {
  const sourceStart = Math.max(0, sampleOffsetFrames);
  const availableFrames = sample.left.length - sourceStart;
  if (availableFrames <= 0) {
    return;
  }

  const requestedFrames = sampleMaxFrames ?? availableFrames;
  if (requestedFrames <= 0) {
    return;
  }

  const destinationAvailable = destinationLeft.length - startFrame;
  if (destinationAvailable <= 0) {
    return;
  }

  const framesToMix = Math.min(availableFrames, requestedFrames, destinationAvailable);
  const sourceLeft = sample.left;
  const sourceRight = sample.right;
  if (!signal) {
    for (let index = 0; index < framesToMix; index += 1) {
      const source = sourceStart + index;
      const target = startFrame + index;
      destinationLeft[target] += sourceLeft[source] * gain;
      destinationRight[target] += sourceRight[source] * gain;
    }
    return;
  }
  for (let index = 0; index < framesToMix; index += 1) {
    if ((index & 0x7ff) === 0) {
      throwIfAborted(signal);
    }
    const source = sourceStart + index;
    const target = startFrame + index;
    destinationLeft[target] += sourceLeft[source] * gain;
    destinationRight[target] += sourceRight[source] * gain;
  }
}

function measurePeak(left: Float32Array, right: Float32Array): number {
  let peak = 0;
  for (let index = 0; index < left.length; index += 1) {
    const absLeft = Math.abs(left[index]);
    const absRight = Math.abs(right[index]);
    if (absLeft > peak) {
      peak = absLeft;
    }
    if (absRight > peak) {
      peak = absRight;
    }
  }
  return peak;
}

function scalePcm(channel: Float32Array, scale: number): void {
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] *= scale;
  }
}
