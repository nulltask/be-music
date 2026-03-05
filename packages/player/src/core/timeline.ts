import { createTimingResolver, type TimingResolver } from '@be-music/audio-renderer';
import { isScrollChannel, normalizeObjectKey, type BeatResolver, type BeMusicJson } from '@be-music/json';
import { findLastIndexAtOrBefore } from '@be-music/utils';

export interface MeasureTimelinePoint {
  measure: number;
  seconds: number;
}

export interface BpmTimelinePoint {
  bpm: number;
  seconds: number;
}

export interface ScrollTimelinePoint {
  beat: number;
  speed: number;
}

export interface StopBeatWindow {
  beat: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export function createMeasureTimeline(
  json: BeMusicJson,
  resolver: TimingResolver,
  beatResolver: BeatResolver,
): MeasureTimelinePoint[] {
  const maxMeasure = resolveMaxMeasureIndex(json);
  const timeline: MeasureTimelinePoint[] = [];
  for (let measure = 0; measure <= maxMeasure + 1; measure += 1) {
    const seconds = resolver.beatToSeconds(beatResolver.measureToBeat(measure, 0));
    if (!Number.isFinite(seconds)) {
      continue;
    }
    timeline.push({ measure, seconds });
  }

  return timeline;
}

export function createBpmTimeline(json: BeMusicJson, resolver: TimingResolver): BpmTimelinePoint[] {
  const timeline: BpmTimelinePoint[] = [];
  let previousSeconds = Number.NaN;
  let previousBpm = Number.NaN;

  for (const point of resolver.tempoPoints) {
    const seconds = resolver.beatToSeconds(point.beat);
    if (!Number.isFinite(seconds) || !Number.isFinite(point.bpm) || point.bpm <= 0) {
      continue;
    }
    if (Math.abs(seconds - previousSeconds) < 1e-6 && Math.abs(point.bpm - previousBpm) < 1e-6) {
      continue;
    }
    timeline.push({
      bpm: point.bpm,
      seconds,
    });
    previousSeconds = seconds;
    previousBpm = point.bpm;
  }

  if (timeline.length === 0) {
    const fallbackBpm = Number.isFinite(json.metadata.bpm) && json.metadata.bpm > 0 ? json.metadata.bpm : 130;
    timeline.push({ bpm: fallbackBpm, seconds: 0 });
  }

  return timeline;
}

export function createScrollTimeline(json: BeMusicJson, beatResolver: BeatResolver): ScrollTimelinePoint[] {
  const timeline: ScrollTimelinePoint[] = [];
  const scrollMap = json.bms.scroll;
  if (Object.keys(scrollMap).length === 0) {
    return timeline;
  }

  for (const event of json.events) {
    if (!isScrollChannel(event.channel)) {
      continue;
    }
    const key = normalizeObjectKey(event.value);
    if (!Object.hasOwn(scrollMap, key)) {
      continue;
    }
    const speed = scrollMap[key];
    if (typeof speed !== 'number' || !Number.isFinite(speed)) {
      continue;
    }
    const beat = beatResolver.eventToBeat(event);
    if (!Number.isFinite(beat) || beat < 0) {
      continue;
    }
    timeline.push({
      beat,
      speed,
    });
  }

  return timeline;
}

export function createBeatAtSecondsResolver(json: BeMusicJson): (seconds: number) => number {
  const resolver = createTimingResolver(json);
  const stopWindows = createStopBeatWindows(resolver);
  let lastSeconds = Number.NEGATIVE_INFINITY;
  let stopCursor = 0;
  let endedStopSeconds = 0;

  return (seconds: number): number => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return 0;
    }
    const safeSeconds = Math.max(0, seconds);

    // Playback time usually increases monotonically; keep a cursor to avoid re-scanning stop windows every frame.
    if (safeSeconds + 1e-9 < lastSeconds) {
      stopCursor = 0;
      endedStopSeconds = 0;
    }
    lastSeconds = safeSeconds;

    while (stopCursor < stopWindows.length && safeSeconds >= stopWindows[stopCursor]!.endSeconds) {
      endedStopSeconds += stopWindows[stopCursor]!.durationSeconds;
      stopCursor += 1;
    }
    const activeWindow = stopWindows[stopCursor];
    if (activeWindow && safeSeconds >= activeWindow.startSeconds && safeSeconds < activeWindow.endSeconds) {
      return activeWindow.beat;
    }

    const adjustedSeconds = Math.max(0, safeSeconds - endedStopSeconds);
    return secondsToBeatWithoutStops(resolver.tempoPoints, adjustedSeconds);
  };
}

export function createStopBeatWindows(resolver: TimingResolver): StopBeatWindow[] {
  const durationByBeat = new Map<number, number>();
  for (const point of resolver.stopPoints) {
    const current = durationByBeat.get(point.beat) ?? 0;
    durationByBeat.set(point.beat, current + point.seconds);
  }

  return [...durationByBeat.entries()]
    .sort(([leftBeat], [rightBeat]) => leftBeat - rightBeat)
    .map(([beat, durationSeconds]) => {
      const startSeconds = resolver.beatToSeconds(beat);
      return {
        beat,
        startSeconds,
        endSeconds: startSeconds + durationSeconds,
        durationSeconds,
      } satisfies StopBeatWindow;
    });
}

export function createMeasureBoundariesBeats(json: BeMusicJson, beatResolver: BeatResolver): number[] {
  const maxMeasure = resolveMaxMeasureIndex(json);
  const boundaries: number[] = [];
  let previous = Number.NaN;

  for (let measure = 0; measure <= maxMeasure + 1; measure += 1) {
    const beat = beatResolver.measureToBeat(measure, 0);
    if (!Number.isFinite(beat)) {
      continue;
    }
    if (Math.abs(beat - previous) < 1e-9) {
      continue;
    }
    boundaries.push(beat);
    previous = beat;
  }

  return boundaries;
}

function secondsToBeatWithoutStops(
  tempoPoints: ReadonlyArray<{ beat: number; bpm: number; seconds: number }>,
  seconds: number,
): number {
  if (tempoPoints.length === 0 || seconds <= 0) {
    return 0;
  }
  const index = findLastIndexAtOrBefore(tempoPoints, seconds, (point) => point.seconds);

  const point = tempoPoints[Math.max(0, index)]!;
  const elapsed = Math.max(0, seconds - point.seconds);
  return point.beat + (elapsed * point.bpm) / 60;
}

function resolveMaxMeasureIndex(json: BeMusicJson): number {
  let maxMeasure = 0;
  for (const event of json.events) {
    if (event.measure > maxMeasure) {
      maxMeasure = event.measure;
    }
  }
  for (const measure of json.measures) {
    if (measure.index > maxMeasure) {
      maxMeasure = measure.index;
    }
  }
  return Math.max(0, maxMeasure);
}
