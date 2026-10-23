import { findLastIndexAtOrBefore, findLastIndexBefore } from '@be-music/shared-utils/core';
import {
  DEFAULT_BPM,
  normalizeChannel,
  normalizeObjectKey,
  resolveBMSBase,
  type BeMusicEvent,
  type BeMusicJSON,
} from '@be-music/chart-source';
import { createBeatResolver, isStopChannel, parseBPMFrom03Token, sortEvents, type BeatResolver } from './index.ts';

export interface TempoPoint {
  beat: number;
  bpm: number;
  seconds: number;
  /**
   * BPM the readouts show when it differs from `bpm`. Set for negative `#BPMxx` events: timing integrates the full
   * |BPM|, but LR2 converts the value to int first (LR2body.exe 0x42b960 `__ftol`), so NOWBPM shows |trunc(BPM)|.
   */
  displayBPM?: number;
}

export interface StopPoint {
  beat: number;
  seconds: number;
  cumulativeSeconds: number;
}

/**
 * Position of the first negative `#BPMxx` event (channel 08) — LR2's reverse-scroll gimmick anchor. LR2 integrates
 * note times at |BPM| (so the timeline stays monotonic) and, from this point on, mirrors the DISPLAY and JUDGE
 * clocks around it while its event pump freezes: nothing behind the reversal ever sounds or gets judged, and the
 * chart visually scrolls backwards forever. See docs/bms-spec.md "Negative BPM" and issue #134.
 */
export interface TempoReversalPoint {
  beat: number;
  seconds: number;
}

/**
 * Display beat past an LR2 negative-BPM reversal. LR2 mirrors the chart POSITION, not the clock:
 * `songtimer = 2 * bpmChangedBmstime - songtimer` on the forward position (OpenLR2 `LR2f.cpp:2185-2188`, LR2body.exe
 * 0x406d81), so the chart recedes exactly as fast as the forward beat advances through the post-reversal tempo map —
 * at the |BPM| of the negative value, following later tempo changes, and pausing during post-reversal STOPs.
 *
 * Returns `beat` unchanged at or before the reversal. Past it the mirrored beat pins at the chart head instead of
 * receding into negative positions (a documented deviation — see docs/bms-spec.md "Negative BPM").
 */
export function mirrorBeatAtTempoReversal(
  reversal: TempoReversalPoint | undefined,
  seconds: number,
  beat: number,
): number {
  if (reversal === undefined || seconds <= reversal.seconds) {
    return beat;
  }
  return Math.max(0, reversal.beat * 2 - beat);
}

/**
 * Channels LR2 fires BEFORE the negative-BPM event when they share its tick. LR2 sorts same-tick events by op
 * (`CMP_NotesByRealTimingOp`, OpenLR2 `LR2f.cpp:24013`): BGM (op 1), BPM (op 3), and the BGA layers (ops 4 / 6 / 7)
 * precede the exBPM (op 8) that arms the reversal, while STOP (op 9), lane sounds (10–29), and invisible objects
 * (30+) come after it and freeze with the pump. `0A` (BGA layer 2) is grouped with the other BGA layers.
 */
const CHANNELS_FIRING_BEFORE_REVERSAL: ReadonlySet<string> = new Set(['01', '03', '04', '06', '07', '0A']);

/** Same-tick tolerance: both sides come from the same `beatToSeconds`, so equal positions agree to the last bit. */
const REVERSAL_TICK_EPSILON_SECONDS = 1e-9;

/**
 * Whether an event at `seconds` on `channel` still fires under LR2's negative-BPM reversal. LR2's event pump freezes
 * at the reversal: everything strictly before it fires, everything after it never does, and on the reversal tick
 * itself only the channels LR2 orders before the negative BPM (BGM, BPM, BGA) fire. Always `true` without a reversal.
 */
export function firesBeforeTempoReversal(
  reversal: TempoReversalPoint | undefined,
  seconds: number,
  channel: string,
): boolean {
  if (reversal === undefined) {
    return true;
  }
  if (seconds < reversal.seconds - REVERSAL_TICK_EPSILON_SECONDS) {
    return true;
  }
  if (seconds > reversal.seconds + REVERSAL_TICK_EPSILON_SECONDS) {
    return false;
  }
  return CHANNELS_FIRING_BEFORE_REVERSAL.has(normalizeChannel(channel));
}

export interface TimingResolver {
  tempoPoints: TempoPoint[];
  stopPoints: StopPoint[];
  /** Set when the chart contains a negative `#BPMxx` reference — the LR2 reverse-scroll anchor. */
  reversal?: TempoReversalPoint;
  beatToSeconds: (beat: number) => number;
  eventToSeconds: (event: BeMusicEvent) => number;
  bpmAtBeat: (beat: number) => number;
  /** BPM the readouts show at `beat` — `bpmAtBeat` except where a {@link TempoPoint.displayBPM} overrides it. */
  displayBPMAtBeat: (beat: number) => number;
}

export interface TimingBuildContext {
  sortedEvents: BeMusicEvent[];
  beatResolver: BeatResolver;
}

export function createTimingBuildContext(json: BeMusicJSON): TimingBuildContext {
  return {
    sortedEvents: sortEvents(json.events),
    beatResolver: createBeatResolver(json),
  };
}

export function createTimingResolver(json: BeMusicJSON): TimingResolver {
  return createTimingResolverWithContext(json, createTimingBuildContext(json));
}

export function createTimingResolverWithContext(json: BeMusicJSON, context: TimingBuildContext): TimingResolver {
  const { sortedEvents, beatResolver } = context;
  const { points: tempoPoints, reversalBeat } = createTempoPoints(json, sortedEvents, beatResolver);
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

  const displayBPMAtBeat = (beat: number): number => {
    if (tempoPoints.length === 0) {
      return json.metadata.bpm > 0 ? json.metadata.bpm : DEFAULT_BPM;
    }
    const index = findLastIndexAtOrBefore(tempoPoints, beat, (point) => point.beat);
    const point = tempoPoints[Math.max(0, index)]!;
    return point.displayBPM ?? point.bpm;
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
    reversal: reversalBeat === undefined ? undefined : { beat: reversalBeat, seconds: beatToSeconds(reversalBeat) },
    bpmAtBeat,
    displayBPMAtBeat,
    beatToSeconds,
    eventToSeconds: (event) => beatToSeconds(beatResolver.eventToBeat(event)),
  };
}

interface TempoIntegration {
  points: TempoPoint[];
  /** Beat of the first negative `#BPMxx` event, if any — the LR2 reverse-scroll anchor. */
  reversalBeat?: number;
}

function createTempoPoints(
  json: BeMusicJSON,
  sortedEvents: BeMusicEvent[],
  beatResolver: BeatResolver,
): TempoIntegration {
  const baseBPM = json.metadata.bpm > 0 ? json.metadata.bpm : DEFAULT_BPM;
  const points: TempoPoint[] = [{ beat: 0, bpm: baseBPM, seconds: 0 }];
  let reversalBeat: number | undefined;
  for (const { event, bpm } of collectTempoChanges(json, sortedEvents)) {
    const beat = beatResolver.eventToBeat(event);
    // LR2 truncates the BPM to int before its `< 0` check (LR2body.exe 0x42b960 `__ftol`), so -1 < BPM < 0 never
    // reverses — it only crawls at |BPM|.
    if (Math.trunc(bpm) < 0 && reversalBeat === undefined) {
      reversalBeat = beat;
    }
    // LR2 integrates negative exBPM at |BPM| (LR2_bmsload.cpp:2841-2843) — the timeline never runs backwards; the
    // reversal is a presentation/judging gimmick anchored at the first negative event. Of several changes at one beat
    // the last in chart order wins.
    integrateTempoPoint(points, beat, Math.abs(bpm), bpm < 0 ? Math.abs(Math.trunc(bpm)) : undefined);
  }
  return { points, reversalBeat };
}

/** A BPM change object (`03`, or `08` with `#BPMxx`) that sets a non-zero BPM. */
export interface TempoChange {
  readonly event: BeMusicEvent;
  /** The BPM as written; negative for a `#BPMxx` that triggers LR2's reverse scroll. */
  readonly bpm: number;
}

/**
 * The BPM changes of a chart, in chart order: channel `03` read as hex (always positive), channel `08` through
 * `#BPMxx`. Zero and undefined `#BPMxx` references are ignored; a negative `#BPMxx` is kept with its sign, since the
 * engine plays it as LR2's reverse scroll. Several at one position all appear; the last one wins. Not part of the
 * package API (the chart fingerprint reads exact positions from the events).
 */
export function collectTempoChanges(json: BeMusicJSON, sortedEvents: ReadonlyArray<BeMusicEvent>): TempoChange[] {
  const changes: TempoChange[] = [];
  const idBase = resolveBMSBase(json);
  for (const event of sortedEvents) {
    const channel = normalizeChannel(event.channel);
    if (channel !== '03' && channel !== '08') {
      continue;
    }
    if (channel === '03') {
      const bpm = parseBPMFrom03Token(event.value);
      if (bpm > 0) {
        changes.push({ event, bpm });
      }
      continue;
    }
    const bpm = json.resources.bpm[normalizeObjectKey(event.value, idBase, json.sourceFormat === 'bmson')];
    if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm === 0) {
      // Zero and undefined slot references stay dropped (previous tempo continues). Real LR2 degenerates on both —
      // a zero slot puts +inf into its precomputed table and an undefined slot hits its -1.0 sentinel (behaving
      // like `#BPMxx -1`) — so neither is worth reproducing; see docs/bms-spec.md.
      continue;
    }
    changes.push({ event, bpm });
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
  json: BeMusicJSON,
  sortedEvents: ReadonlyArray<BeMusicEvent>,
  beatResolver: BeatResolver,
): StopChange[] {
  const idBase = resolveBMSBase(json);
  const lastStopWins = json.sourceFormat === 'bms';
  const changes: StopChange[] = [];
  const indexByBeat = new Map<number, number>();
  for (const event of sortedEvents) {
    if (!isStopChannel(normalizeChannel(event.channel))) {
      continue;
    }
    const duration = json.resources.stop[normalizeObjectKey(event.value, idBase, json.sourceFormat === 'bmson')];
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
  json: BeMusicJSON,
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

function integrateTempoPoint(points: TempoPoint[], beat: number, bpm: number, displayBPM?: number): void {
  const last = points[points.length - 1]!;
  if (beat < last.beat) {
    return;
  }
  if (Math.abs(beat - last.beat) < 1e-9) {
    last.bpm = bpm;
    if (displayBPM === undefined) {
      delete last.displayBPM;
    } else {
      last.displayBPM = displayBPM;
    }
    return;
  }

  const seconds = last.seconds + ((beat - last.beat) * 60) / last.bpm;
  const point: TempoPoint = { beat, bpm, seconds };
  if (displayBPM !== undefined) {
    point.displayBPM = displayBPM;
  }
  points.push(point);
}
