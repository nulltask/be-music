import { findLastIndexAtOrBefore, findLastIndexBefore } from '@be-music/utils/core';
import {
  DEFAULT_BPM,
  normalizeChannel,
  normalizeObjectKey,
  resolveBmsBase,
  type BeMusicEvent,
  type BeMusicJson,
} from '@be-music/json';
import { createBeatResolver, isStopChannel, parseBpmFrom03Token, sortEvents, type BeatResolver } from './index.ts';

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

export interface TimingBuildContext {
  sortedEvents: BeMusicEvent[];
  beatResolver: BeatResolver;
}

export function createTimingBuildContext(json: BeMusicJson): TimingBuildContext {
  return {
    sortedEvents: sortEvents(json.events),
    beatResolver: createBeatResolver(json),
  };
}

export function createTimingResolver(json: BeMusicJson): TimingResolver {
  return createTimingResolverWithContext(json, createTimingBuildContext(json));
}

export function createTimingResolverWithContext(json: BeMusicJson, context: TimingBuildContext): TimingResolver {
  const { sortedEvents, beatResolver } = context;
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
    bpmAtBeat,
    beatToSeconds,
    eventToSeconds: (event) => beatToSeconds(beatResolver.eventToBeat(event)),
  };
}

function createTempoPoints(json: BeMusicJson, sortedEvents: BeMusicEvent[], beatResolver: BeatResolver): TempoPoint[] {
  const baseBpm = json.metadata.bpm > 0 ? json.metadata.bpm : DEFAULT_BPM;
  const points: TempoPoint[] = [{ beat: 0, bpm: baseBpm, seconds: 0 }];
  const idBase = resolveBmsBase(json);

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
    const bpm = json.resources.bpm[normalizeObjectKey(event.value, idBase)];
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

  const idBase = resolveBmsBase(json);
  for (const event of sortedEvents) {
    const normalizedChannel = normalizeChannel(event.channel);
    if (!isStopChannel(normalizedChannel)) {
      continue;
    }
    const beat = beatResolver.eventToBeat(event);
    const duration = json.resources.stop[normalizeObjectKey(event.value, idBase)];
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
  const match = /^\s*(\d{3})(?:\.(\d{3}))?(?:[ \t　]{1,6})([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:[^0-9].*)?$/u.exec(rawValue);
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

function bpmAtBeatFromTempoPoints(tempoPoints: TempoPoint[], beat: number): number {
  if (tempoPoints.length === 0) {
    return DEFAULT_BPM;
  }
  const index = findLastIndexAtOrBefore(tempoPoints, beat, (point) => point.beat);
  return tempoPoints[Math.max(0, index)]!.bpm;
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
