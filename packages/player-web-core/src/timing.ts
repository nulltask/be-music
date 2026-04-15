import {
  createBeatResolver,
  isScrollChannel,
  isStopChannel,
  parseBpmFrom03Token,
  sortEvents,
  type BeatResolver,
} from '../../chart/src/index.ts';
import { DEFAULT_BPM, normalizeChannel, normalizeObjectKey, type BeMusicEvent, type BeMusicJson } from '@be-music/json';

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

export interface ScrollTimelinePoint {
  beat: number;
  speed: number;
}

export interface SpeedTimelinePoint {
  beat: number;
  speed: number;
}

export interface TimingResolver {
  tempoPoints: TempoPoint[];
  stopPoints: StopPoint[];
  beatResolver: BeatResolver;
  beatToSeconds: (beat: number) => number;
  eventToSeconds: (event: BeMusicEvent) => number;
  bpmAtBeat: (beat: number) => number;
}

export function createTimingResolver(json: BeMusicJson): TimingResolver {
  const beatResolver = createBeatResolver(json);
  const sortedEvents = sortEvents(json.events);
  const tempoPoints = createTempoPoints(json, sortedEvents, beatResolver);
  const stopPoints = createStopPoints(json, tempoPoints, sortedEvents, beatResolver);

  const beatToSecondsWithoutStops = (beat: number): number => {
    if (beat <= 0 || tempoPoints.length === 0) {
      return 0;
    }

    const index = findLastIndexAtOrBefore(tempoPoints, beat, (point) => point.beat);
    const point = tempoPoints[Math.max(0, index)]!;
    const deltaBeat = beat - point.beat;
    return point.seconds + (deltaBeat * 60) / point.bpm;
  };

  const bpmAtBeat = (beat: number): number => {
    if (tempoPoints.length === 0) {
      return json.metadata.bpm > 0 ? json.metadata.bpm : DEFAULT_BPM;
    }
    const index = findLastIndexAtOrBefore(tempoPoints, beat, (point) => point.beat);
    return tempoPoints[Math.max(0, index)]!.bpm;
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
    return base + stopPoints[index]!.cumulativeSeconds;
  };

  return {
    tempoPoints,
    stopPoints,
    beatResolver,
    beatToSeconds,
    eventToSeconds: (event) => beatToSeconds(beatResolver.eventToBeat(event)),
    bpmAtBeat,
  };
}

export function createBeatAtSecondsResolver(json: BeMusicJson): (seconds: number) => number {
  const resolver = createTimingResolver(json);
  return createBeatAtSecondsResolverFromTimingResolver(resolver);
}

export function createBeatAtSecondsResolverFromTimingResolver(resolver: TimingResolver): (seconds: number) => number {
  let lastSeconds = Number.NEGATIVE_INFINITY;
  let stopCursor = 0;
  let endedStopSeconds = 0;

  return (seconds: number): number => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return 0;
    }
    const safeSeconds = Math.max(0, seconds);
    if (safeSeconds + 1e-9 < lastSeconds) {
      stopCursor = 0;
      endedStopSeconds = 0;
    }
    lastSeconds = safeSeconds;

    while (stopCursor < resolver.stopPoints.length) {
      const currentStop = resolver.stopPoints[stopCursor]!;
      const startSeconds = beatToSecondsWithoutStops(resolver.tempoPoints, currentStop.beat) + endedStopSeconds;
      const endSeconds = startSeconds + currentStop.seconds;
      if (safeSeconds < endSeconds) {
        if (safeSeconds >= startSeconds) {
          return currentStop.beat;
        }
        break;
      }
      endedStopSeconds += currentStop.seconds;
      stopCursor += 1;
    }

    const adjustedSeconds = Math.max(0, safeSeconds - endedStopSeconds);
    return secondsToBeatWithoutStops(resolver.tempoPoints, adjustedSeconds);
  };
}

export function createScrollTimeline(json: BeMusicJson, beatResolver: BeatResolver): ScrollTimelinePoint[] {
  const timeline: ScrollTimelinePoint[] = [];
  const scrollMap = json.bms.scroll;
  if (Object.keys(scrollMap).length === 0) {
    return timeline;
  }

  for (const event of sortEvents(json.events)) {
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

export function createSpeedTimeline(json: BeMusicJson, beatResolver: BeatResolver): SpeedTimelinePoint[] {
  const timeline: SpeedTimelinePoint[] = [];
  const speedMap = json.bms.speed;
  if (Object.keys(speedMap).length === 0) {
    return timeline;
  }

  for (const event of sortEvents(json.events)) {
    if (normalizeChannel(event.channel) !== 'SP') {
      continue;
    }
    const key = normalizeObjectKey(event.value);
    if (!Object.hasOwn(speedMap, key)) {
      continue;
    }
    const speed = speedMap[key];
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0) {
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

export function createMeasureBoundariesBeats(json: BeMusicJson, beatResolver: BeatResolver): number[] {
  const maxMeasure = resolveMaxMeasure(json);
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

function beatToSecondsWithoutStops(
  tempoPoints: ReadonlyArray<TempoPoint>,
  beat: number,
): number {
  if (beat <= 0 || tempoPoints.length === 0) {
    return 0;
  }
  const index = findLastIndexAtOrBefore(tempoPoints, beat, (point) => point.beat);
  const point = tempoPoints[Math.max(0, index)]!;
  const deltaBeat = beat - point.beat;
  return point.seconds + (deltaBeat * 60) / point.bpm;
}

function createStopPoints(
  json: BeMusicJson,
  tempoPoints: TempoPoint[],
  sortedEvents: BeMusicEvent[],
  beatResolver: BeatResolver,
): StopPoint[] {
  const rawPoints: Array<{ beat: number; seconds: number; order: number }> = [];
  let order = 0;

  for (const stp of json.bms.stp) {
    const parsed = parseBemaniaDxStpStopPoint(stp, beatResolver);
    if (!parsed) {
      continue;
    }
    rawPoints.push({
      ...parsed,
      order,
    });
    order += 1;
  }

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
    const seconds = (duration / 192) * (240 / bpm);
    rawPoints.push({
      beat,
      seconds,
      order,
    });
    order += 1;
  }

  rawPoints.sort((left, right) => {
    if (left.beat !== right.beat) {
      return left.beat - right.beat;
    }
    return left.order - right.order;
  });

  const points: StopPoint[] = [];
  let cumulativeSeconds = 0;

  for (const point of rawPoints) {
    cumulativeSeconds += point.seconds;
    points.push({
      beat: point.beat,
      seconds: point.seconds,
      cumulativeSeconds,
    });
  }

  return points;
}

function parseBemaniaDxStpStopPoint(
  rawValue: string,
  beatResolver: BeatResolver,
): { beat: number; seconds: number } | undefined {
  const match =
    /^\s*(\d{3})(?:\.(\d{3}))?(?:[ \t\u3000]{1,6})([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:[^0-9].*)?$/u.exec(rawValue);
  if (!match) {
    return undefined;
  }

  const measure = Number.parseInt(match[1]!, 10);
  const position = Number.parseInt(match[2] ?? '000', 10);
  const durationMs = Number.parseFloat(match[3]!);
  if (!Number.isFinite(measure) || !Number.isFinite(position) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return undefined;
  }

  return {
    beat: beatResolver.measureToBeat(measure, position / 1000),
    seconds: durationMs / 1000,
  };
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

function bpmAtBeatFromTempoPoints(tempoPoints: TempoPoint[], beat: number): number {
  if (tempoPoints.length === 0) {
    return DEFAULT_BPM;
  }
  const index = findLastIndexAtOrBefore(tempoPoints, beat, (point) => point.beat);
  return tempoPoints[Math.max(0, index)]!.bpm;
}

function secondsToBeatWithoutStops(
  tempoPoints: ReadonlyArray<TempoPoint>,
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

function findLastIndexAtOrBefore<T>(
  items: ReadonlyArray<T>,
  target: number,
  resolveValue: (item: T) => number,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const value = resolveValue(items[mid]!);
    if (value <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low - 1;
}

function findLastIndexBefore<T>(
  items: ReadonlyArray<T>,
  target: number,
  resolveValue: (item: T) => number,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const value = resolveValue(items[mid]!);
    if (value < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low - 1;
}

function resolveMaxMeasure(json: BeMusicJson): number {
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
  return maxMeasure;
}
