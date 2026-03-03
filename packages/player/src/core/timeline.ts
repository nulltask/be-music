import { createTimingResolver, type TimingResolver } from '@be-music/audio-renderer';
import { isScrollChannel, normalizeObjectKey, type BeatResolver, type BeMusicJson } from '@be-music/json';

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
  const maxEventMeasure = json.events.reduce((max, event) => Math.max(max, event.measure), 0);
  const maxDefinedMeasure = json.measures.reduce((max, measure) => Math.max(max, measure.index), 0);
  const maxMeasure = Math.max(0, maxEventMeasure, maxDefinedMeasure);
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

  return (seconds: number): number => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return 0;
    }

    let endedStopSeconds = 0;
    for (const window of stopWindows) {
      if (seconds < window.startSeconds) {
        break;
      }
      if (seconds < window.endSeconds) {
        return window.beat;
      }
      endedStopSeconds += window.durationSeconds;
    }

    const adjustedSeconds = Math.max(0, seconds - endedStopSeconds);
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
  const maxEventMeasure = json.events.reduce((max, event) => Math.max(max, event.measure), 0);
  const maxDefinedMeasure = json.measures.reduce((max, measure) => Math.max(max, measure.index), 0);
  const maxMeasure = Math.max(0, maxEventMeasure, maxDefinedMeasure);
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

  let low = 0;
  let high = tempoPoints.length - 1;
  let index = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const point = tempoPoints[mid]!;
    if (point.seconds <= seconds) {
      index = mid;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  const point = tempoPoints[index]!;
  const elapsed = Math.max(0, seconds - point.seconds);
  return point.beat + (elapsed * point.bpm) / 60;
}
