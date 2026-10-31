import {
  collectBmsWAVVolumeMultipliers,
  collectBmsWAVPlaybackModifiers,
  resolveBmsWAVPlayback,
  type BmsWAVPlaybackModifiers,
  firesBeforeTempoReversal,
  isPlayLaneSoundChannel,
  resolveChart,
  usesMonophonicWAVPlayback,
  type ResolvedVolumeChange,
  type TimedSampleTrigger,
  volWAVToLinearGain,
} from '@be-music/chart-model';
// `node:fs/promises` and `node:path` are loaded lazily inside the Node-only entry points (`renderChartFile`,
// `writeAudioFile`, `getOrCreateSample`) so that bundling this module into a browser build doesn't statically
// pull the Node built-ins into the browser bundle. Vite externalises `node:`-prefixed imports for browser
// targets but emits a runtime error if any code path actually reaches them — keeping the imports dynamic
// confines that error to the Node-specific paths the browser never executes (renderJSON / renderSingleSample
// stay browser-safe because they don't touch disk).
type NodeFSPromises = typeof import('node:fs/promises');
type NodePath = typeof import('node:path');
let nodeFSPromisesPromise: Promise<NodeFSPromises> | undefined;
let nodePathPromise: Promise<NodePath> | undefined;
const loadNodeFSPromises = (): Promise<NodeFSPromises> => (nodeFSPromisesPromise ??= import('node:fs/promises'));
const loadNodePath = (): Promise<NodePath> => (nodePathPromise ??= import('node:path'));
import { normalizeObjectKey, type BeMusicJSON } from '@be-music/chart-source';
import {
  isAbortError,
  resolveSampleSliceEnvelope,
  sampleSliceEnvelopeGain,
  SAMPLE_SLICE_FADE_SECONDS,
  throwIfAborted,
  transformStereoPCM,
  type SampleSliceEnvelope,
} from '@be-music/shared-utils/core';
import { parseChartFile, resolveBMSControlFlow } from '@be-music/chart-parser';
import { detectAudioFormat, encodeAIFF16, encodeWAV16 } from './file-codec.ts';
import { createFallbackTone, decodeAudioSample, resampleLinear } from './decode.ts';
import { resolveSamplePath } from './sample-path.ts';
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
  inferBmsLNTypeWhenMissing?: boolean;
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
  /** Authored pitch, pan, frequency and sounding-time limit, applied before host tempo controls. */
  playbackModifiers?: BmsWAVPlaybackModifiers;
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
  /** The chart's `#PATH_WAV` directory, tried before the bare sample path. */
  pathPrefix?: string;
}

interface StereoSample {
  left: Float32Array;
  right: Float32Array;
}

/** A BMS dynamic volume change from the resolved chart (`ResolvedChart.volumeChanges`). */
type DynamicVolumeChange = Pick<ResolvedVolumeChange, 'bus' | 'seconds' | 'gain'>;
type DynamicVolumeBus = DynamicVolumeChange['bus'];

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
  slice?: ScheduledSampleSlice;
}

/** A slice window that cuts its source file, with the ramps that keep the cut from clicking. */
interface ScheduledSampleSlice {
  lengthFrames: number;
  envelope: SampleSliceEnvelope;
}

interface ScheduledSampleFrameWindow {
  sampleOffsetFrames: number;
  sampleMaxFrames: number;
  slice?: ScheduledSampleSlice;
}

const DEFAULT_SAMPLE_RATE = 44_100;
const DEFAULT_TAIL_SECONDS = 2;
const DEFAULT_GAIN = 0.9;
const FALLBACK_SAMPLE_CACHE = new Map<string, StereoSample>();

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

export async function renderJSON(json: BeMusicJSON, options: RenderOptions = {}): Promise<RenderResult> {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const normalize = options.normalize ?? true;
  const tailSeconds = options.tailSeconds ?? DEFAULT_TAIL_SECONDS;
  const gain = (options.gain ?? DEFAULT_GAIN) * volWAVToLinearGain(json.bms.volWAV);
  const startSeconds = Number.isFinite(options.startSeconds) ? Math.max(0, options.startSeconds ?? 0) : 0;
  // BMS spec — an undefined / missing / undecodable `#WAVxx` reference is SILENT (LR2 / beatoraja both skip it).
  // `fallbackToneSeconds` exists as an opt-in debug aid; 0 renders a 1-frame silent placeholder so every downstream
  // path (scheduling, gain, progress reporting) still sees a sample.
  const fallbackToneSeconds = options.fallbackToneSeconds ?? 0;
  const baseDir = options.baseDir ?? process.cwd();
  const signal = options.signal;
  const resolveTriggerGain = options.resolveTriggerGain;
  const onSampleLoadProgress = options.onSampleLoadProgress;
  throwIfAborted(signal);

  const resolved = resolveChart(json, { inferBmsLNTypeWhenMissing: options.inferBmsLNTypeWhenMissing === true });
  const dynamicVolumeChanges = splitDynamicVolumeChangesByBus(resolved.volumeChanges);
  // LR2's event pump freezes at a negative-BPM reversal: nothing behind the reversal ever sounds, and on the reversal
  // tick only the BGM ordered before the negative BPM does (Scene04_Play.cpp:1267-1269). Match that audibility in the
  // offline render.
  const reversal = resolved.reversal;
  const triggers =
    reversal === undefined
      ? resolved.sampleTriggers
      : resolved.sampleTriggers.filter((trigger) =>
          firesBeforeTempoReversal(reversal, trigger.seconds, trigger.channel),
        );

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
    scalePCM(left, scale);
    scalePCM(right, scale);
  }

  return {
    sampleRate,
    left,
    right,
    durationSeconds: left.length / sampleRate,
    peak: normalize && peak > 1 ? 1 : peak,
  };
}

function splitDynamicVolumeChangesByBus(changes: ReadonlyArray<DynamicVolumeChange>): DynamicVolumeChangesByBus {
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
  json: BeMusicJSON;
  triggers: ReadonlyArray<TimedSampleTrigger>;
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
  const latestBMSScheduleBySampleKey = new Map<string, number>();
  const bgmVolumeState: DynamicVolumeState = { index: 0, gain: 1 };
  const playVolumeState: DynamicVolumeState = { index: 0, gain: 1 };
  let maxFrame = Math.max(1, Math.round(tailSeconds * sampleRate));

  // BMS spec — `#PATH_WAV` declares a directory prefix the chart's WAVs live under. The sample-path resolver tries
  // `pathPrefix + samplePath` before the bare path so charts that organize their WAVs under a sub-folder (e.g.
  // `wav/kick.wav` reachable via `#PATH_WAV wav/`) resolve correctly.
  const pathWAVPrefix = typeof json.bms.pathWAV === 'string' ? json.bms.pathWAV : undefined;
  // MacBeat WAVCMD volume is a percentage (100 = unity). Pitch and duration are handled separately.
  const wavCmdVolumeMultipliers = collectBmsWAVVolumeMultipliers(json);
  const playbackModifiers = collectBmsWAVPlaybackModifiers(json);
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
      pathPrefix: pathWAVPrefix,
      playbackModifiers: playbackModifiers.get(trigger.sampleKey),
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
    trimPreviousBMSRetrigger(json, trigger, start, scheduled, latestBMSScheduleBySampleKey);

    const scheduleIndex =
      scheduled.push({
        start,
        sample,
        triggerGain,
        sampleOffsetFrames: frameWindow.sampleOffsetFrames,
        sampleMaxFrames: frameWindow.sampleMaxFrames,
        slice: frameWindow.slice,
      }) - 1;
    if (usesMonophonicWAVPlayback(json)) {
      latestBMSScheduleBySampleKey.set(trigger.sampleKey, scheduleIndex);
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
  const lengthFrames =
    requestedDurationFrames === undefined ? availableFrames : Math.min(availableFrames, requestedDurationFrames);
  if (lengthFrames <= 0) {
    return undefined;
  }
  const envelope = resolveSampleSliceEnvelope(
    sampleOffsetFrames,
    requestedDurationFrames,
    sample.left.length,
    Math.round(SAMPLE_SLICE_FADE_SECONDS * sampleRate),
  );
  if (envelope.fadeIn === 0 && envelope.fadeOut === 0) {
    return { sampleOffsetFrames, sampleMaxFrames: lengthFrames };
  }
  // A cut slice rings on past its end while it fades out, so the window grows by the fade-out.
  return {
    sampleOffsetFrames,
    sampleMaxFrames: lengthFrames + envelope.fadeOut,
    slice: { lengthFrames, envelope },
  };
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
  json: BeMusicJSON,
  trigger: TimedSampleTrigger,
  start: number,
  bmsonScheduledSlices: Set<string>,
): boolean {
  if (json.sourceFormat !== 'bmson') {
    return true;
  }
  // Each pulse plays its assigned slice, including continuations. Only simultaneous uses of that slice share audio.
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

function trimPreviousBMSRetrigger(
  json: BeMusicJSON,
  trigger: TimedSampleTrigger,
  start: number,
  scheduled: ScheduledSampleRender[],
  latestBMSScheduleBySampleKey: Map<string, number>,
): void {
  if (!usesMonophonicWAVPlayback(json)) {
    return;
  }
  const previousIndex = latestBMSScheduleBySampleKey.get(trigger.sampleKey);
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
      item.slice,
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
  // Spec-compliant default: missing / undecodable samples are silent. Pass a positive value to opt into the
  // debugging sine tone.
  const fallbackToneSeconds = options.fallbackToneSeconds ?? 0;
  throwIfAborted(options.signal);
  const sample = await getOrCreateSample({
    sampleKey: normalizedKey,
    samplePath,
    sampleRate,
    baseDir,
    pathPrefix: options.pathPrefix,
    fallbackToneSeconds,
    loadedSamples: new Map(),
    resolvedPathCache: new Map(),
    signal: options.signal,
    onSampleLoadProgress: options.onSampleLoadProgress,
    playbackModifiers: options.playbackModifiers,
  });
  throwIfAborted(options.signal);
  return toRenderResult(sample, sampleRate, gain);
}

export async function renderChartFile(
  inputPath: string,
  outputPath: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const { resolve, dirname } = await loadNodePath();
  const chartPath = resolve(inputPath);
  const json = resolveBMSControlFlow(await parseChartFile(chartPath, { signal: options.signal }));
  const audioRendered = await renderJSON(json, {
    ...options,
    baseDir: options.baseDir ?? dirname(chartPath),
  });
  await writeAudioFile(outputPath, audioRendered);
  return audioRendered;
}

export async function writeAudioFile(outputPath: string, result: RenderResult): Promise<void> {
  const [{ resolve }, { writeFile }] = await Promise.all([loadNodePath(), loadNodeFSPromises()]);
  const destination = resolve(outputPath);
  const format = detectAudioFormat(destination);
  const encoded = format === 'aiff' ? encodeAIFF16(result) : encodeWAV16(result);
  await writeFile(destination, encoded);
}

async function getOrCreateSample(params: {
  playbackModifiers?: BmsWAVPlaybackModifiers;
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
    playbackModifiers,
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

  const originalFallback = getFallbackSample(sampleKey, sampleRate, fallbackToneSeconds);
  const fallback = playbackModifiers
    ? transformStereoPCM(
        originalFallback.left,
        originalFallback.right,
        sampleRate,
        sampleRate,
        resolveBmsWAVPlayback(playbackModifiers, sampleRate),
        signal,
      )
    : originalFallback;
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
    const { readFile } = await loadNodeFSPromises();
    const buffer = await readFile(resolvedPath, { signal });
    throwIfAborted(signal);
    const decoded = await decodeAudioSample(buffer, resolvedPath, signal);
    throwIfAborted(signal);
    const rightSource = decoded.right ?? decoded.left;
    const sample = playbackModifiers
      ? transformStereoPCM(
          decoded.left,
          rightSource,
          decoded.sampleRate,
          sampleRate,
          resolveBmsWAVPlayback(playbackModifiers, decoded.sampleRate),
          signal,
        )
      : {
          left: resampleLinear(decoded.left, decoded.sampleRate, sampleRate, signal),
          right: resampleLinear(rightSource, decoded.sampleRate, sampleRate, signal),
        };
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
  slice?: ScheduledSampleSlice,
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
  if (slice) {
    for (let index = 0; index < framesToMix; index += 1) {
      if (signal && (index & 0x7ff) === 0) {
        throwIfAborted(signal);
      }
      const source = sourceStart + index;
      const target = startFrame + index;
      const frameGain = gain * sampleSliceEnvelopeGain(index, slice.lengthFrames, slice.envelope);
      destinationLeft[target] += sourceLeft[source] * frameGain;
      destinationRight[target] += sourceRight[source] * frameGain;
    }
    return;
  }
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

function scalePCM(channel: Float32Array, scale: number): void {
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] *= scale;
  }
}
