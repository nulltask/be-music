import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  collectLnobjEndEvents,
  createBeatResolver,
  DEFAULT_BPM,
  isLandmineChannel,
  isSampleTriggerChannel,
  isStopChannel,
  resolveBmsLongNotes,
  normalizeChannel,
  normalizeObjectKey,
  parseBpmFrom03Token,
  sortEvents,
  type BeatResolver,
  type BeMusicEvent,
  type BeMusicJson,
} from '@be-music/json';
import { findLastIndexAtOrBefore, findLastIndexBefore, isAbortError, throwIfAborted } from '@be-music/utils';
import { parseChartFile, resolveBmsControlFlow } from '@be-music/parser';
import { detectAudioFormat, encodeAiff16, encodeWav16 } from './audio-file-codec.ts';
import { createFallbackTone, decodeAudioSample, resampleLinear } from './audio-decode.ts';
import { resolveSamplePath } from './sample-path.ts';
export interface TempoPoint {
  beat: number;
  bpm: number;
  seconds: number;
}

export interface StopPoint {
  beat: number;
  seconds: number;
  cumulativeSeconds: number;
}

export interface TimingResolver {
  tempoPoints: TempoPoint[];
  stopPoints: StopPoint[];
  beatToSeconds: (beat: number) => number;
  eventToSeconds: (event: BeMusicEvent) => number;
  bpmAtBeat: (beat: number) => number;
}

export interface TimedSampleTrigger {
  event: BeMusicEvent;
  beat: number;
  seconds: number;
  channel: string;
  sampleKey: string;
  samplePath?: string;
  sampleOffsetSeconds: number;
  sampleDurationSeconds?: number;
  sampleSliceId?: string;
}

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

export interface CollectSampleTriggersOptions {
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
}

interface StereoSample {
  left: Float32Array;
  right: Float32Array;
}

interface TimingBuildContext {
  sortedEvents: BeMusicEvent[];
  beatResolver: BeatResolver;
}

const DEFAULT_SAMPLE_RATE = 44_100;
const DEFAULT_TAIL_SECONDS = 2;
const DEFAULT_GAIN = 0.9;
const EMPTY_EVENT_SET = new Set<BeMusicEvent>();
const FALLBACK_SAMPLE_CACHE = new Map<string, StereoSample>();

export function createTimingResolver(json: BeMusicJson): TimingResolver {
  return createTimingResolverWithContext(json, createTimingBuildContext(json));
}

function createTimingResolverWithContext(json: BeMusicJson, context: TimingBuildContext): TimingResolver {
  const { sortedEvents, beatResolver } = context;
  const tempoPoints = createTempoPoints(json, sortedEvents, beatResolver);
  const stopPoints = createStopPoints(json, tempoPoints, sortedEvents, beatResolver);

  const beatToSecondsWithoutStops = (beat: number): number => {
    if (beat <= 0 || tempoPoints.length === 0) {
      return 0;
    }

    const index = findLastIndexAtOrBefore(tempoPoints, beat, (point) => point.beat);
    const point = tempoPoints[Math.max(0, index)];
    const deltaBeat = beat - point.beat;
    return point.seconds + (deltaBeat * 60) / point.bpm;
  };

  const bpmAtBeat = (beat: number): number => {
    if (tempoPoints.length === 0) {
      return json.metadata.bpm > 0 ? json.metadata.bpm : DEFAULT_BPM;
    }
    const index = findLastIndexAtOrBefore(tempoPoints, beat, (point) => point.beat);
    return tempoPoints[Math.max(0, index)].bpm;
  };

  const beatToSeconds = (beat: number): number => {
    const base = beatToSecondsWithoutStops(beat);
    if (stopPoints.length === 0) {
      return base;
    }
    const index = findLastIndexBefore(stopPoints, beat, (point) => point.beat);
    if (index < 0) {
      return base;
    }
    return base + stopPoints[index].cumulativeSeconds;
  };

  return {
    tempoPoints,
    stopPoints,
    bpmAtBeat,
    beatToSeconds,
    eventToSeconds: (event) => beatToSeconds(beatResolver.eventToBeat(event)),
  };
}

export function collectSampleTriggers(
  json: BeMusicJson,
  resolver = createTimingResolver(json),
  options: CollectSampleTriggersOptions = {},
): TimedSampleTrigger[] {
  return collectSampleTriggersWithContext(json, resolver, createTimingBuildContext(json), options);
}

function collectSampleTriggersWithContext(
  json: BeMusicJson,
  resolver: TimingResolver,
  context: TimingBuildContext,
  options: CollectSampleTriggersOptions = {},
): TimedSampleTrigger[] {
  const { sortedEvents, beatResolver } = context;
  const isBmsChart = json.sourceFormat === 'bms';
  const lnobjEndEvents = isBmsChart ? collectLnobjEndEvents(json) : EMPTY_EVENT_SET;
  const suppressedBmsLongNoteEvents = isBmsChart
    ? resolveBmsLongNotes(json, {
      inferLnTypeWhenMissing: options.inferBmsLnTypeWhenMissing === true,
    }).suppressedTriggerEvents
    : EMPTY_EVENT_SET;
  const selectedEvents: Array<{ event: BeMusicEvent; normalizedChannel: string }> = [];
  for (const event of sortedEvents) {
    const normalizedChannel = normalizeChannel(event.channel);
    if (!isSampleTriggerChannel(normalizedChannel) || isLandmineChannel(normalizedChannel)) {
      continue;
    }
    if (lnobjEndEvents.has(event)) {
      continue;
    }
    if (suppressedBmsLongNoteEvents.has(event)) {
      continue;
    }
    selectedEvents.push({ event, normalizedChannel });
  }
  const events = selectedEvents.map((item) => item.event);
  const bmsonPlaybackMap =
    json.sourceFormat === 'bmson' ? createBmsonSamplePlaybackMap(json, resolver, events, beatResolver) : undefined;

  const triggers: TimedSampleTrigger[] = [];
  for (const item of selectedEvents) {
    const event = item.event;
    const sampleKey = normalizeObjectKey(event.value);
    const playback = bmsonPlaybackMap?.get(event);
    const beat = beatResolver.eventToBeat(event);
    triggers.push({
      event,
      beat,
      seconds: resolver.beatToSeconds(beat),
      channel: item.normalizedChannel,
      sampleKey,
      samplePath: json.resources.wav[sampleKey],
      sampleOffsetSeconds: playback?.offsetSeconds ?? 0,
      sampleDurationSeconds: playback?.durationSeconds,
      sampleSliceId: playback?.sliceId,
    } satisfies TimedSampleTrigger);
  }
  return triggers;
}

export async function renderJson(json: BeMusicJson, options: RenderOptions = {}): Promise<RenderResult> {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const normalize = options.normalize ?? true;
  const tailSeconds = options.tailSeconds ?? DEFAULT_TAIL_SECONDS;
  const gain = options.gain ?? DEFAULT_GAIN;
  const startSeconds = Number.isFinite(options.startSeconds) ? Math.max(0, options.startSeconds ?? 0) : 0;
  const fallbackToneSeconds = options.fallbackToneSeconds ?? 0.08;
  const baseDir = options.baseDir ?? process.cwd();
  const signal = options.signal;
  const resolveTriggerGain = options.resolveTriggerGain;
  const onSampleLoadProgress = options.onSampleLoadProgress;
  throwIfAborted(signal);

  const timingContext = createTimingBuildContext(json);
  const resolver = createTimingResolverWithContext(json, timingContext);
  const triggers = collectSampleTriggersWithContext(json, resolver, timingContext, {
    inferBmsLnTypeWhenMissing: options.inferBmsLnTypeWhenMissing === true,
  });

  const loadedSamples = new Map<string, StereoSample>();
  const resolvedPathCache = new Map<string, string | undefined>();

  const scheduled: Array<{
    start: number;
    sample: StereoSample;
    triggerGain: number;
    sampleOffsetFrames: number;
    sampleMaxFrames?: number;
  }> = [];
  const bmsonScheduledSlices = new Set<string>();
  const latestBmsScheduleBySampleKey = new Map<string, number>();
  let maxFrame = Math.max(1, Math.round(tailSeconds * sampleRate));

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
    });

    const sampleOffsetFrames = Math.max(0, Math.round(trigger.sampleOffsetSeconds * sampleRate));
    const availableFrames = sample.left.length - sampleOffsetFrames;
    if (availableFrames <= 0) {
      continue;
    }
    const requestedDurationFrames =
      typeof trigger.sampleDurationSeconds === 'number' && Number.isFinite(trigger.sampleDurationSeconds)
        ? Math.max(1, Math.round(trigger.sampleDurationSeconds * sampleRate))
        : undefined;
    const sampleMaxFrames =
      requestedDurationFrames === undefined ? availableFrames : Math.min(availableFrames, requestedDurationFrames);
    if (sampleMaxFrames <= 0) {
      continue;
    }
    const rawTriggerGain = resolveTriggerGain?.(trigger) ?? 1;
    const triggerGain = Number.isFinite(rawTriggerGain) ? Math.max(0, rawTriggerGain) : 1;

    const start = Math.max(0, Math.round((trigger.seconds - startSeconds) * sampleRate));
    if (json.sourceFormat === 'bmson' && trigger.sampleSliceId) {
      const dedupeKey = `${trigger.sampleSliceId}@${start}`;
      if (bmsonScheduledSlices.has(dedupeKey)) {
        continue;
      }
      bmsonScheduledSlices.add(dedupeKey);
    }
    if (json.sourceFormat === 'bms') {
      const previousIndex = latestBmsScheduleBySampleKey.get(trigger.sampleKey);
      if (previousIndex !== undefined) {
        const previous = scheduled[previousIndex];
        const maxFramesUntilRetrigger = Math.max(0, start - previous.start);
        const currentPreviousMaxFrames =
          previous.sampleMaxFrames ?? previous.sample.left.length - previous.sampleOffsetFrames;
        previous.sampleMaxFrames = Math.min(currentPreviousMaxFrames, maxFramesUntilRetrigger);
      }
    }

    const scheduleIndex = scheduled.push({ start, sample, triggerGain, sampleOffsetFrames, sampleMaxFrames }) - 1;
    if (json.sourceFormat === 'bms') {
      latestBmsScheduleBySampleKey.set(trigger.sampleKey, scheduleIndex);
    }
    if (triggerGain > 0) {
      maxFrame = Math.max(maxFrame, start + sampleMaxFrames + Math.round(tailSeconds * sampleRate));
    }
  }

  const left = new Float32Array(maxFrame);
  const right = new Float32Array(maxFrame);

  if (!signal) {
    for (let scheduleIndex = 0; scheduleIndex < scheduled.length; scheduleIndex += 1) {
      const item = scheduled[scheduleIndex]!;
      if (item.triggerGain <= 0) {
        continue;
      }
      mixSample(
        left,
        right,
        item.sample,
        item.start,
        gain * item.triggerGain,
        item.sampleOffsetFrames,
        item.sampleMaxFrames,
      );
    }
  } else {
    for (let scheduleIndex = 0; scheduleIndex < scheduled.length; scheduleIndex += 1) {
      if ((scheduleIndex & 0x1f) === 0) {
        throwIfAborted(signal);
      }
      const item = scheduled[scheduleIndex]!;
      if (item.triggerGain <= 0) {
        continue;
      }
      mixSample(
        left,
        right,
        item.sample,
        item.start,
        gain * item.triggerGain,
        item.sampleOffsetFrames,
        item.sampleMaxFrames,
        signal,
      );
    }
  }

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

export async function renderSingleSample(
  sampleKey: string,
  samplePath: string | undefined,
  options: RenderSingleSampleOptions = {},
): Promise<RenderResult> {
  const normalizedKey = normalizeObjectKey(sampleKey);
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

function createTimingBuildContext(json: BeMusicJson): TimingBuildContext {
  return {
    sortedEvents: sortEvents(json.events),
    beatResolver: createBeatResolver(json),
  };
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

function createTempoPoints(json: BeMusicJson, sortedEvents: BeMusicEvent[], beatResolver: BeatResolver): TempoPoint[] {
  const baseBpm = json.metadata.bpm > 0 ? json.metadata.bpm : DEFAULT_BPM;
  const points: TempoPoint[] = [{ beat: 0, bpm: baseBpm, seconds: 0 }];

  for (const event of sortedEvents) {
    const channel = normalizeChannel(event.channel);
    if (channel !== '03' && channel !== '08') {
      continue;
    }
    const beat = beatResolver.eventToBeat(event);
    if (channel === '03') {
      const bpm = parseBpmFrom03Token(event.value);
      if (bpm > 0) {
        integrateTempoPoint(points, beat, bpm);
      }
      continue;
    }
    const bpm = json.resources.bpm[normalizeObjectKey(event.value)];
    if (typeof bpm === 'number' && bpm > 0) {
      integrateTempoPoint(points, beat, bpm);
    }
  }

  return points;
}

function createStopPoints(
  json: BeMusicJson,
  tempoPoints: TempoPoint[],
  sortedEvents: BeMusicEvent[],
  beatResolver: BeatResolver,
): StopPoint[] {
  const points: StopPoint[] = [];
  let cumulativeSeconds = 0;

  for (const event of sortedEvents) {
    const normalizedChannel = normalizeChannel(event.channel);
    if (!isStopChannel(normalizedChannel)) {
      continue;
    }
    const beat = beatResolver.eventToBeat(event);
    const duration = json.resources.stop[normalizeObjectKey(event.value)];
    if (typeof duration !== 'number' || duration <= 0) {
      continue;
    }
    const bpm = bpmAtBeatFromTempoPoints(tempoPoints, beat);
    // BMS STOP uses 1/192 of a measure as the unit.
    const seconds = (duration / 192) * (240 / bpm);
    cumulativeSeconds += seconds;
    points.push({
      beat,
      seconds,
      cumulativeSeconds,
    });
  }

  return points;
}

function bpmAtBeatFromTempoPoints(tempoPoints: TempoPoint[], beat: number): number {
  if (tempoPoints.length === 0) {
    return DEFAULT_BPM;
  }
  const index = findLastIndexAtOrBefore(tempoPoints, beat, (point) => point.beat);
  return tempoPoints[Math.max(0, index)].bpm;
}

function integrateTempoPoint(points: TempoPoint[], beat: number, bpm: number): void {
  const last = points[points.length - 1]!;
  if (beat < last.beat) {
    return;
  }
  if (Math.abs(beat - last.beat) < 1e-9) {
    last.bpm = bpm;
    return;
  }

  const seconds = last.seconds + ((beat - last.beat) * 60) / last.bpm;
  points.push({
    beat,
    bpm,
    seconds,
  });
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
  const cacheKey = `${baseDir}:${samplePath}`;
  const resolvedPath = resolvedPathCache.has(cacheKey)
    ? resolvedPathCache.get(cacheKey)
    : await resolveSamplePath(baseDir, samplePath, signal);
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

function createBmsonSamplePlaybackMap(
  json: BeMusicJson,
  resolver: TimingResolver,
  sampleEvents: BeMusicEvent[],
  beatResolver: BeatResolver,
): Map<BeMusicEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }> {
  const perSampleKey = new Map<string, Array<{ event: BeMusicEvent; beat: number; seconds: number; sampleKey: string }>>();
  for (const event of sampleEvents) {
    const sampleKey = normalizeObjectKey(event.value);
    let entries = perSampleKey.get(sampleKey);
    if (!entries) {
      entries = [];
      perSampleKey.set(sampleKey, entries);
    }
    const beat = beatResolver.eventToBeat(event);
    entries.push({
      event,
      beat,
      seconds: resolver.beatToSeconds(beat),
      sampleKey,
    });
  }

  const playbackMap = new Map<BeMusicEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }>();
  for (const entries of perSampleKey.values()) {
    // sampleEvents are already beat-sorted, so each sample bucket keeps beat order.
    let anchorSeconds = 0;
    let hasAnchor = false;
    let sliceIndex = 0;

    for (let index = 0; index < entries.length;) {
      const firstEntry = entries[index]!;
      const currentBeat = firstEntry.beat;
      let end = index + 1;
      let shouldRestart = firstEntry.event.bmson?.c !== true;
      while (end < entries.length && Math.abs(entries[end]!.beat - currentBeat) < 1e-9) {
        if (entries[end]!.event.bmson?.c !== true) {
          shouldRestart = true;
        }
        end += 1;
      }

      if (!hasAnchor || shouldRestart) {
        anchorSeconds = firstEntry.seconds;
        hasAnchor = true;
      }

      const offsetSeconds = Math.max(0, firstEntry.seconds - anchorSeconds);
      const next = end < entries.length ? entries[end]! : undefined;
      const durationSeconds = next ? Math.max(0, next.seconds - firstEntry.seconds) : undefined;
      const sliceId = `${firstEntry.sampleKey}:${sliceIndex}`;
      sliceIndex += 1;
      const playback = { offsetSeconds, durationSeconds, sliceId };

      for (let cursor = index; cursor < end; cursor += 1) {
        playbackMap.set(entries[cursor]!.event, playback);
      }
      index = end;
    }
  }

  return playbackMap;
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
