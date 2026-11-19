import {
  collectBmsWAVVolumeMultipliers,
  collectBmsWAVPlaybackModifiers,
  firesBeforeTempoReversal,
  playsAtKeysoundVolume,
  resolveChart,
  usesMonophonicWAVPlayback,
  type ResolvedVolumeChange,
  type TimedSampleTrigger,
  volWAVToLinearGain,
} from '@be-music/chart-model';
// Load filesystem adapters only when rendering from or writing to disk.
type NodeFSPromises = typeof import('node:fs/promises');
type NodePath = typeof import('node:path');
let nodeFSPromisesPromise: Promise<NodeFSPromises> | undefined;
let nodePathPromise: Promise<NodePath> | undefined;
const loadNodeFSPromises = (): Promise<NodeFSPromises> => (nodeFSPromisesPromise ??= import('node:fs/promises'));
const loadNodePath = (): Promise<NodePath> => (nodePathPromise ??= import('node:path'));
import type { BeMusicJSON } from '@be-music/chart-source';
import {
  readSampleFrame,
  resolveSampleVoiceEnvelope,
  resolveStereoBalance,
  sampleSliceEnvelopeGain,
  SAMPLE_SLICE_FADE_SECONDS,
  throwIfAborted,
  type SampleSliceEnvelope,
} from '@be-music/shared-utils/core';
import { parseChartFile, resolveBMSControlFlow } from '@be-music/chart-parser';
import { detectAudioFormat, encodeAIFF16, encodeWAV16 } from './file-codec.ts';
import {
  createSampleLoader,
  measurePeak,
  type RenderSampleLoadProgress,
  type RenderResult,
  type StereoSample,
} from '@be-music/audio-sample';
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
  /** Source frames the voice plays; at a rate other than 1 it sounds for `sampleMaxFrames / voice.rate` frames. */
  sampleMaxFrames?: number;
  slice?: ScheduledSampleSlice;
  voice?: ScheduledSampleVoice;
}

/** A trigger's own rate and stereo balance (an LRX note's `frq` and `pan`). */
interface ScheduledSampleVoice {
  rate: number;
  leftGain: number;
  rightGain: number;
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

  const { scheduled, maxFrame } = await scheduleSampleRenders({
    json,
    triggers,
    sampleRate,
    tailSeconds,
    startSeconds,
    baseDir,
    fallbackToneSeconds,
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
  const loadSample = createSampleLoader({
    sampleRate,
    baseDir,
    fallbackToneSeconds,
    signal,
    onSampleLoadProgress,
    pathPrefix: pathWAVPrefix,
  });
  for (const trigger of triggers) {
    throwIfAborted(signal);
    const sample = await loadSample(trigger.sampleKey, trigger.samplePath, playbackModifiers.get(trigger.sampleKey));
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

    const voice = resolveScheduledSampleVoice(trigger);
    const scheduleIndex =
      scheduled.push({
        start,
        sample,
        triggerGain,
        sampleOffsetFrames: frameWindow.sampleOffsetFrames,
        sampleMaxFrames: frameWindow.sampleMaxFrames,
        slice: frameWindow.slice,
        ...(voice ? { voice } : {}),
      }) - 1;
    if (usesMonophonicWAVPlayback(json, trigger.sampleKey)) {
      latestBMSScheduleBySampleKey.set(trigger.sampleKey, scheduleIndex);
    }
    if (triggerGain > 0) {
      const soundingFrames = Math.ceil(frameWindow.sampleMaxFrames / (voice?.rate ?? 1));
      maxFrame = Math.max(maxFrame, start + soundingFrames + Math.round(tailSeconds * sampleRate));
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
  const envelope = resolveSampleVoiceEnvelope(
    sampleOffsetFrames,
    requestedDurationFrames,
    sample.left.length,
    Math.round(SAMPLE_SLICE_FADE_SECONDS * sampleRate),
    Math.round((trigger.sampleAttackSeconds ?? 0) * sampleRate),
    Math.round((trigger.sampleReleaseSeconds ?? 0) * sampleRate),
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

/** A trigger's own rate and balance, or `undefined` when it plays at rate 1 in the centre. */
function resolveScheduledSampleVoice(trigger: TimedSampleTrigger): ScheduledSampleVoice | undefined {
  const rate =
    typeof trigger.samplePlaybackRate === 'number' && trigger.samplePlaybackRate > 0 ? trigger.samplePlaybackRate : 1;
  const balance = resolveStereoBalance(trigger.samplePan ?? 0);
  if (rate === 1 && balance.left === 1 && balance.right === 1) return undefined;
  return { rate, leftGain: balance.left, rightGain: balance.right };
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
  const volumeBus: DynamicVolumeBus = playsAtKeysoundVolume(trigger.channel, trigger.event) ? 'play' : 'bgm';
  const dynamicGain =
    volumeBus === 'play'
      ? advanceDynamicVolumeGain(dynamicVolumeChanges.play, trigger.seconds, playVolumeState)
      : advanceDynamicVolumeGain(dynamicVolumeChanges.bgm, trigger.seconds, bgmVolumeState);
  // `#WAVCMD 01 xx vv` per-slot volume — multiplied in alongside the dynamic-volume bus state so a chart can stack a
  // 50% `#WAVCMD` slot under a `97`/`98` runtime cut.
  const wavCmdGain = wavCmdVolumeMultipliers.get(trigger.sampleKey) ?? 1;
  // An LRX note's own `vol`.
  const noteGain = typeof trigger.sampleGain === 'number' && trigger.sampleGain >= 0 ? trigger.sampleGain : 1;
  return (Number.isFinite(rawTriggerGain) ? Math.max(0, rawTriggerGain) : 1) * dynamicGain * wavCmdGain * noteGain;
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
  if (!usesMonophonicWAVPlayback(json, trigger.sampleKey)) {
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
      item.voice,
    );
  }
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
  voice?: ScheduledSampleVoice,
): void {
  if (voice) {
    mixSampleVoice(
      destinationLeft,
      destinationRight,
      sample,
      startFrame,
      gain,
      sampleOffsetFrames,
      sampleMaxFrames,
      voice,
      slice,
      signal,
    );
    return;
  }
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

/**
 * {@link mixSample} for a voice with its own rate and balance: each output frame reads the source `rate` frames on,
 * interpolated, and the slice envelope runs over source frames as it does at rate 1.
 */
function mixSampleVoice(
  destinationLeft: Float32Array,
  destinationRight: Float32Array,
  sample: StereoSample,
  startFrame: number,
  gain: number,
  sampleOffsetFrames: number,
  sampleMaxFrames: number | undefined,
  voice: ScheduledSampleVoice,
  slice: ScheduledSampleSlice | undefined,
  signal: AbortSignal | undefined,
): void {
  const sourceStart = Math.max(0, sampleOffsetFrames);
  const sourceFrames = Math.min(sample.left.length - sourceStart, sampleMaxFrames ?? Number.POSITIVE_INFINITY);
  if (!(sourceFrames > 0)) return;
  const outputFrames = Math.min(Math.ceil(sourceFrames / voice.rate), destinationLeft.length - startFrame);
  const leftGain = gain * voice.leftGain;
  const rightGain = gain * voice.rightGain;
  for (let index = 0; index < outputFrames; index += 1) {
    if (signal && (index & 0x7ff) === 0) throwIfAborted(signal);
    const played = index * voice.rate;
    if (played >= sourceFrames) break;
    const envelope = slice ? sampleSliceEnvelopeGain(played, slice.lengthFrames, slice.envelope) : 1;
    const target = startFrame + index;
    destinationLeft[target] += readSampleFrame(sample.left, sourceStart + played) * leftGain * envelope;
    destinationRight[target] += readSampleFrame(sample.right, sourceStart + played) * rightGain * envelope;
  }
}

function scalePCM(channel: Float32Array, scale: number): void {
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] *= scale;
  }
}
