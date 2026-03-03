import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  createBeatResolver,
  DEFAULT_BPM,
  isLandmineChannel,
  isSampleTriggerChannel,
  normalizeChannel,
  normalizeObjectKey,
  parseBpmFrom03Token,
  sortEvents,
  type BeatResolver,
  type BeMusicEvent,
  type BeMusicJson,
} from '@be-music/json';
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
  baseDir?: string;
  fallbackToneSeconds?: number;
  onSampleLoadProgress?: (progress: RenderSampleLoadProgress) => void;
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

    const index = findLastIndex(tempoPoints, (point) => point.beat <= beat);
    const point = tempoPoints[Math.max(0, index)];
    const deltaBeat = beat - point.beat;
    return point.seconds + (deltaBeat * 60) / point.bpm;
  };

  const bpmAtBeat = (beat: number): number => {
    if (tempoPoints.length === 0) {
      return json.metadata.bpm > 0 ? json.metadata.bpm : DEFAULT_BPM;
    }
    const index = findLastIndex(tempoPoints, (point) => point.beat <= beat);
    return tempoPoints[Math.max(0, index)].bpm;
  };

  const beatToSeconds = (beat: number): number => {
    const base = beatToSecondsWithoutStops(beat);
    if (stopPoints.length === 0) {
      return base;
    }
    const index = findLastIndex(stopPoints, (point) => point.beat < beat);
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

export function collectSampleTriggers(json: BeMusicJson, resolver = createTimingResolver(json)): TimedSampleTrigger[] {
  return collectSampleTriggersWithContext(json, resolver, createTimingBuildContext(json));
}

function collectSampleTriggersWithContext(
  json: BeMusicJson,
  resolver: TimingResolver,
  context: TimingBuildContext,
): TimedSampleTrigger[] {
  const { sortedEvents, beatResolver } = context;
  const events = sortedEvents.filter(
    (event) => isSampleTriggerChannel(event.channel) && !isLandmineChannel(event.channel),
  );
  const bmsonPlaybackMap =
    json.sourceFormat === 'bmson' ? createBmsonSamplePlaybackMap(json, resolver, events, beatResolver) : undefined;

  return events.map((event) => {
    const sampleKey = normalizeObjectKey(event.value);
    const playback = bmsonPlaybackMap?.get(event);
    const beat = beatResolver.eventToBeat(event);
    return {
      event,
      beat,
      seconds: resolver.beatToSeconds(beat),
      channel: normalizeChannel(event.channel),
      sampleKey,
      samplePath: json.resources.wav[sampleKey],
      sampleOffsetSeconds: playback?.offsetSeconds ?? 0,
      sampleDurationSeconds: playback?.durationSeconds,
      sampleSliceId: playback?.sliceId,
    } satisfies TimedSampleTrigger;
  });
}

export async function renderJson(json: BeMusicJson, options: RenderOptions = {}): Promise<RenderResult> {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const normalize = options.normalize ?? true;
  const tailSeconds = options.tailSeconds ?? DEFAULT_TAIL_SECONDS;
  const gain = options.gain ?? DEFAULT_GAIN;
  const fallbackToneSeconds = options.fallbackToneSeconds ?? 0.08;
  const baseDir = options.baseDir ?? process.cwd();
  const onSampleLoadProgress = options.onSampleLoadProgress;

  const timingContext = createTimingBuildContext(json);
  const resolver = createTimingResolverWithContext(json, timingContext);
  const triggers = collectSampleTriggersWithContext(json, resolver, timingContext);

  const loadedSamples = new Map<string, StereoSample>();
  const resolvedPathCache = new Map<string, string | undefined>();

  const scheduled: Array<{
    start: number;
    sample: StereoSample;
    sampleOffsetFrames: number;
    sampleMaxFrames?: number;
  }> = [];
  const bmsonScheduledSlices = new Set<string>();
  const latestBmsScheduleBySampleKey = new Map<string, number>();
  let maxFrame = Math.max(1, Math.round(tailSeconds * sampleRate));

  for (const trigger of triggers) {
    const sample = await getOrCreateSample({
      sampleKey: trigger.sampleKey,
      samplePath: trigger.samplePath,
      sampleRate,
      baseDir,
      fallbackToneSeconds,
      loadedSamples,
      resolvedPathCache,
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

    const start = Math.max(0, Math.round(trigger.seconds * sampleRate));
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

    const scheduleIndex = scheduled.push({ start, sample, sampleOffsetFrames, sampleMaxFrames }) - 1;
    if (json.sourceFormat === 'bms') {
      latestBmsScheduleBySampleKey.set(trigger.sampleKey, scheduleIndex);
    }
    maxFrame = Math.max(maxFrame, start + sampleMaxFrames + Math.round(tailSeconds * sampleRate));
  }

  const left = new Float32Array(maxFrame);
  const right = new Float32Array(maxFrame);

  for (const item of scheduled) {
    mixSample(left, right, item.sample, item.start, gain, item.sampleOffsetFrames, item.sampleMaxFrames);
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
  const json = resolveBmsControlFlow(await parseChartFile(chartPath));
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
  const changes: Array<{ beat: number; bpm: number }> = [];
  for (const event of sortedEvents) {
    const channel = normalizeChannel(event.channel);
    if (channel !== '03' && channel !== '08') {
      continue;
    }
    const beat = beatResolver.eventToBeat(event);
    if (channel === '03') {
      const bpm = parseBpmFrom03Token(event.value);
      if (bpm > 0) {
        changes.push({ beat, bpm });
      }
      continue;
    }
    const bpm = json.resources.bpm[normalizeObjectKey(event.value)];
    if (typeof bpm === 'number' && bpm > 0) {
      changes.push({ beat, bpm });
    }
  }

  for (const change of changes) {
    const last = points[points.length - 1];
    if (change.beat < last.beat) {
      continue;
    }

    if (Math.abs(change.beat - last.beat) < 1e-9) {
      last.bpm = change.bpm;
      continue;
    }

    const seconds = last.seconds + ((change.beat - last.beat) * 60) / last.bpm;
    points.push({
      beat: change.beat,
      bpm: change.bpm,
      seconds,
    });
  }

  return points;
}

function createStopPoints(
  json: BeMusicJson,
  tempoPoints: TempoPoint[],
  sortedEvents: BeMusicEvent[],
  beatResolver: BeatResolver,
): StopPoint[] {
  const stopEvents: Array<{ beat: number; seconds: number }> = [];
  for (const event of sortedEvents) {
    if (normalizeChannel(event.channel) !== '09') {
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
    stopEvents.push({ beat, seconds });
  }

  const points: StopPoint[] = [];
  let cumulativeSeconds = 0;
  for (const stopEvent of stopEvents) {
    cumulativeSeconds += stopEvent.seconds;
    points.push({
      beat: stopEvent.beat,
      seconds: stopEvent.seconds,
      cumulativeSeconds,
    });
  }
  return points;
}

function bpmAtBeatFromTempoPoints(tempoPoints: TempoPoint[], beat: number): number {
  if (tempoPoints.length === 0) {
    return DEFAULT_BPM;
  }
  const index = findLastIndex(tempoPoints, (point) => point.beat <= beat);
  return tempoPoints[Math.max(0, index)].bpm;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  let low = 0;
  let high = items.length - 1;
  let answer = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (predicate(items[mid])) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return answer;
}

async function getOrCreateSample(params: {
  sampleKey: string;
  samplePath?: string;
  sampleRate: number;
  baseDir: string;
  fallbackToneSeconds: number;
  loadedSamples: Map<string, StereoSample>;
  resolvedPathCache: Map<string, string | undefined>;
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
    onSampleLoadProgress,
  } = params;

  const cached = loadedSamples.get(sampleKey);
  if (cached) {
    onSampleLoadProgress?.({
      stage: 'cached',
      sampleKey,
      samplePath,
    });
    return cached;
  }

  const fallback = createFallbackTone(sampleKey, sampleRate, fallbackToneSeconds);
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
    : await resolveSamplePath(baseDir, samplePath);
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
    onSampleLoadProgress?.({
      stage: 'reading',
      sampleKey,
      samplePath,
      resolvedPath,
    });
    const buffer = await readFile(resolvedPath);
    const decoded = await decodeAudioSample(buffer, resolvedPath);
    const left = resampleLinear(decoded.left, decoded.sampleRate, sampleRate);
    const rightSource = decoded.right ?? decoded.left;
    const right = resampleLinear(rightSource, decoded.sampleRate, sampleRate);
    const sample = { left, right };
    loadedSamples.set(sampleKey, sample);
    onSampleLoadProgress?.({
      stage: 'decoded',
      sampleKey,
      samplePath,
      resolvedPath,
    });
    return sample;
  } catch {
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

function mixSample(
  destinationLeft: Float32Array,
  destinationRight: Float32Array,
  sample: StereoSample,
  startFrame: number,
  gain: number,
  sampleOffsetFrames = 0,
  sampleMaxFrames?: number,
): void {
  let source = Math.max(0, sampleOffsetFrames);
  let index = 0;
  const maxFrames = sampleMaxFrames ?? sample.left.length;
  while (source < sample.left.length) {
    if (index >= maxFrames) {
      break;
    }
    const target = startFrame + index;
    if (target >= destinationLeft.length) {
      break;
    }
    destinationLeft[target] += sample.left[source] * gain;
    destinationRight[target] += sample.right[source] * gain;
    source += 1;
    index += 1;
  }
}

function createBmsonSamplePlaybackMap(
  json: BeMusicJson,
  resolver: TimingResolver,
  sampleEvents: BeMusicEvent[],
  beatResolver: BeatResolver,
): Map<BeMusicEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }> {
  const perSampleKey = new Map<string, Array<{ event: BeMusicEvent; beat: number; seconds: number }>>();
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
    });
  }

  const playbackMap = new Map<BeMusicEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }>();
  for (const entries of perSampleKey.values()) {
    // sampleEvents are already beat-sorted, so each sample bucket keeps beat order.
    let anchorSeconds = 0;
    let hasAnchor = false;
    let sliceIndex = 0;

    for (let index = 0; index < entries.length;) {
      const currentBeat = entries[index].beat;
      let end = index + 1;
      while (end < entries.length && Math.abs(entries[end].beat - currentBeat) < 1e-9) {
        end += 1;
      }

      const group = entries.slice(index, end);
      const shouldRestart = group.some((entry) => entry.event.bmson?.c !== true);
      if (!hasAnchor || shouldRestart) {
        anchorSeconds = group[0].seconds;
        hasAnchor = true;
      }

      const offsetSeconds = Math.max(0, group[0].seconds - anchorSeconds);
      const next = entries[end];
      const durationSeconds = next ? Math.max(0, next.seconds - group[0].seconds) : undefined;
      const sampleKey = normalizeObjectKey(group[0].event.value);
      const sliceId = `${sampleKey}:${sliceIndex}`;
      sliceIndex += 1;

      for (const entry of group) {
        playbackMap.set(entry.event, { offsetSeconds, durationSeconds, sliceId });
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
