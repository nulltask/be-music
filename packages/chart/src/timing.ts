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
  for (const change of collectTempoChanges(json, sortedEvents)) {
    // Of several changes at one beat the last in chart order wins.
    integrateTempoPoint(points, beatResolver.eventToBeat(change.event), change.bpm);
  }
  return points;
}

/** A BPM change object (`03`, or `08` with `#BPMxx`) that sets a positive BPM. */
export interface TempoChange {
  readonly event: BeMusicEvent;
  readonly bpm: number;
}

/**
 * The BPM changes of a chart, in chart order: channel `03` read as hex, channel `08` through `#BPMxx`, values of 0 or
 * below ignored. Several at one position all appear; the last one wins. Not part of the package API (the chart
 * fingerprint reads exact positions from the events).
 */
export function collectTempoChanges(json: BeMusicJson, sortedEvents: ReadonlyArray<BeMusicEvent>): TempoChange[] {
  const changes: TempoChange[] = [];
  const idBase = resolveBmsBase(json);
  for (const event of sortedEvents) {
    const channel = normalizeChannel(event.channel);
    if (channel !== '03' && channel !== '08') {
      continue;
    }
    const bpm =
      channel === '03' ? parseBpmFrom03Token(event.value) : json.resources.bpm[normalizeObjectKey(event.value, idBase)];
    if (typeof bpm === 'number' && bpm > 0) {
      changes.push({ event, bpm });
    }
  }
  return changes;
}

/** A `#STOPxx` object (BMS) or bmson stop with a positive length, in 1/192 of a 4/4 measure. */
export interface StopChange {
  readonly event: BeMusicEvent;
  readonly beat: number;
  readonly duration: number;
}

/**
 * The STOP objects that take effect, in chart order. BMS keeps one `#STOPxx` per position and the last one wins, as LR2
 * (OpenLR2 L26666-26670) and beatoraja (one STOP per timeline) read it; bmson stops on one pulse all stay and add up,
 * as its spec says. Not part of the package API (the chart fingerprint reads exact positions from the events).
 */
export function collectStopChanges(
  json: BeMusicJson,
  sortedEvents: ReadonlyArray<BeMusicEvent>,
  beatResolver: BeatResolver,
): StopChange[] {
  const idBase = resolveBmsBase(json);
  const lastStopWins = json.sourceFormat === 'bms';
  const changes: StopChange[] = [];
  const indexByBeat = new Map<number, number>();
  for (const event of sortedEvents) {
    if (!isStopChannel(normalizeChannel(event.channel))) {
      continue;
    }
    const duration = json.resources.stop[normalizeObjectKey(event.value, idBase)];
    if (typeof duration !== 'number' || duration <= 0) {
      continue;
    }
    const beat = beatResolver.eventToBeat(event);
    const replaced = lastStopWins ? indexByBeat.get(beat) : undefined;
    if (replaced !== undefined) {
      changes[replaced] = { event, beat, duration };
      continue;
    }
    if (lastStopWins) {
      indexByBeat.set(beat, changes.length);
    }
    changes.push({ event, beat, duration });
  }
  return changes;
}

/** A parsed `#STP xxx.yyy ms` line (BEMANIA DX STOP): measure `xxx`, position `yyy / 1000`, a positive length in ms. */
export interface StpStop {
  readonly measure: number;
  /** Thousandths of the measure, `0..999`. */
  readonly position: number;
  readonly durationMs: number;
  /** The length as written, for consumers that read it exactly. */
  readonly durationText: string;
}

const STP_PATTERN = /^\s*(\d{3})(?:\.(\d{3}))?(?:[ \t　]{1,6})([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:[^0-9].*)?$/u;

/** Parses a `#STP` value, or `undefined` when it is malformed or its length is not positive. */
export function parseStpStop(rawValue: string): StpStop | undefined {
  const match = STP_PATTERN.exec(rawValue);
  if (!match) {
    return undefined;
  }
  const measure = Number.parseInt(match[1]!, 10);
  const position = Number.parseInt(match[2] ?? '000', 10);
  const durationMs = Number.parseFloat(match[3]!);
  if (!Number.isFinite(measure) || !Number.isFinite(position) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return undefined;
  }
  return { measure, position, durationMs, durationText: match[3]! };
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

  // `#STP` lines at one position add up, as do bmson stops; of several BMS `#STOPxx` at one position the last wins.
  for (const stop of collectStopChanges(json, sortedEvents, beatResolver)) {
    const bpm = bpmAtBeatFromTempoPoints(tempoPoints, stop.beat);
    rawPoints.push({
      beat: stop.beat,
      seconds: (stop.duration / 192) * (240 / bpm),
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
  const stop = parseStpStop(rawValue);
  return stop === undefined
    ? undefined
    : { beat: beatResolver.measureToBeat(stop.measure, stop.position / 1000), seconds: stop.durationMs / 1000 };
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
