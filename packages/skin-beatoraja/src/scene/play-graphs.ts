import {
  gaugePercent,
  resolveLaneCover,
  type GaugeHistorySample,
  type LaneCoverState,
  type ScoreHistorySample,
} from '@be-music/player-scene-model';
import { beatorajaGaugeModeFromString, type BeatorajaGaugeState } from '../elements/gauge.ts';
import {
  JUDGE_LANE_REF_1P_BASE,
  JUDGE_LANE_REF_2P_BASE,
  JUDGE_LANE_REF_RANGE,
  OFFSET_HIDDEN_COVER,
  OFFSET_LIFT,
  SYNTHETIC_OFFSET_JUDGE_WORD_SHIFT_1P,
  SYNTHETIC_OFFSET_JUDGE_WORD_SHIFT_2P,
} from '../runtime-ids.ts';
import type { BeatorajaGaugeInput, BeatorajaNoteBreakdown, BeatorajaScoreInput } from './inputs.ts';
import type { BeatorajaPlayClock } from './play-numbers.ts';

/**
 * The gauge as a gauge element draws it (`SkinGauge`): its value, maximum and clear border, and its mode
 * (`beatorajaGaugeModeFromString`, which `main_state.gauge_type()` also reads). `undefined` without a gauge.
 */
export function resolveBeatorajaGaugeState(gauge: BeatorajaGaugeInput | undefined): BeatorajaGaugeState | undefined {
  if (gauge === undefined || gauge.max <= 0) return undefined;
  return {
    value: gauge.current,
    max: gauge.max,
    border: gauge.clearThreshold ?? 0,
    mode: beatorajaGaugeModeFromString(gauge.type),
  };
}

/** What a play skin's bar graphs and sliders read. */
export interface BeatorajaPlayGraphInput {
  /** The engine's latest frame: absent before the first. */
  readonly clock?: BeatorajaPlayClock;
  readonly gauge?: BeatorajaGaugeInput;
  /** The 1P lane covers. */
  readonly cover?: LaneCoverState;
}

/**
 * A play skin's bar graph (`graph[].type`) as a fill ratio, or `undefined` for a type the play does not draw (or
 * before the first frame): the gauge (1, and 6 for 2P, which reads the same gauge), the song's progress (2) and the
 * loading progress (102, done: the play mounts once its assets are decoded).
 */
export function resolveBeatorajaPlayGraphValue(type: number, input: BeatorajaPlayGraphInput): number | undefined {
  const { clock, gauge } = input;
  if (clock === undefined) return undefined;
  switch (type) {
    case 1:
    case 6:
      return gauge !== undefined && gauge.max > 0 ? gauge.current / gauge.max : 0;
    case 2:
      return clock.totalSeconds > 0 ? clock.currentSeconds / clock.totalSeconds : 0;
    case 102:
      return 1;
    default:
      return undefined;
  }
}

/**
 * A play skin's slider (`slider[].type`) position, 0..1, or `undefined` for a type the play does not move: the lane
 * cover (4, and 5 for 2P, which reads the 1P cover) and the song's progress (6; 0 before the first frame).
 */
export function resolveBeatorajaPlaySliderValue(type: number, input: BeatorajaPlayGraphInput): number | undefined {
  switch (type) {
    case 4:
    case 5:
      return input.cover !== undefined ? resolveLaneCover(input.cover).sudden : 0;
    case 6: {
      const clock = input.clock;
      if (clock === undefined || !Number.isFinite(clock.totalSeconds) || clock.totalSeconds <= 0) return 0;
      if (!Number.isFinite(clock.currentSeconds)) return 0;
      return Math.max(0, Math.min(1, clock.currentSeconds / clock.totalSeconds));
    }
    default:
      return undefined;
  }
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

interface CachedPolyline {
  readonly length: number;
  readonly scale: number;
  readonly points: readonly { x: number; y: number }[];
}

const SCORE_POLYLINES = new WeakMap<readonly ScoreHistorySample[], CachedPolyline>();

/**
 * The EX-score graph (`graph[].type` 110) as points in the unit square: chart progress across, the EX score in
 * fraction of its maximum (twice `total`) up. `undefined` while the graph has no sample or the chart no notes. Kept per
 * graph while it has the same samples, so a frame that asks again gets the same points.
 */
export function resolveBeatorajaScorePolyline(
  history: readonly ScoreHistorySample[],
  total: number,
): readonly { x: number; y: number }[] | undefined {
  if (history.length === 0) return undefined;
  const maxExScore = total * 2;
  if (maxExScore <= 0) return undefined;
  const cached = SCORE_POLYLINES.get(history);
  if (cached !== undefined && cached.length === history.length && cached.scale === maxExScore) return cached.points;
  const points = history.map((sample) => ({
    x: clampUnit(sample.progress),
    y: clampUnit(sample.exScore / maxExScore),
  }));
  SCORE_POLYLINES.set(history, { length: history.length, scale: maxExScore, points });
  return points;
}

/** The gauge graph (`graph[].type` 107, `gaugegraph[]`) as points: progress across, the gauge in percent up. */
export function resolveBeatorajaGaugePolyline(
  history: readonly GaugeHistorySample[],
): readonly { x: number; y: number }[] | undefined {
  if (history.length === 0) return undefined;
  return history.map((sample) => ({ x: sample.progress, y: clampUnit(sample.value / 100) }));
}

const BREAKDOWN_BARS = new WeakMap<BeatorajaNoteBreakdown, readonly number[]>();

/** The note-kind bars of the judge graph's type 0 (`[normal, ln, scratch, bss]`), the same array for one breakdown. */
export function beatorajaNoteBreakdownBars(breakdown: BeatorajaNoteBreakdown): readonly number[] {
  let bars = BREAKDOWN_BARS.get(breakdown);
  if (bars === undefined) {
    bars = [breakdown.normal, breakdown.ln, breakdown.scratch, breakdown.bss];
    BREAKDOWN_BARS.set(breakdown, bars);
  }
  return bars;
}

/** The judgment counts bars (`[perfect, great, good, bad, poor]`). */
export function beatorajaJudgeCountBars(score: BeatorajaScoreInput): number[] {
  return [score.perfect, score.great, score.good, score.bad, score.poor];
}

/**
 * The timing histogram of the judge graph's type 2 (`SkinJudgeGraph` hit distribution): 21 bins of 10 ms from -100 ms
 * (early) to +100 ms (late), the outer ones taking every offset beyond. `undefined` before the first timed judgment.
 */
export function beatorajaTimingHistogram(timings: readonly { readonly deltaMs: number }[]): number[] | undefined {
  if (timings.length === 0) return undefined;
  const BIN_COUNT = 21;
  const BIN_WIDTH_MS = 10;
  const RANGE_HALF_MS = ((BIN_COUNT - 1) / 2) * BIN_WIDTH_MS;
  const bins = Array.from({ length: BIN_COUNT }, () => 0);
  for (const timing of timings) {
    let index = Math.floor((timing.deltaMs + RANGE_HALF_MS) / BIN_WIDTH_MS);
    if (index < 0) index = 0;
    else if (index >= BIN_COUNT) index = BIN_COUNT - 1;
    bins[index] = bins[index]! + 1;
  }
  return bins;
}

/** What a play skin's judge graphs read. */
export interface BeatorajaPlayJudgeGraphInput {
  readonly breakdown?: BeatorajaNoteBreakdown;
  /** The running counts; absent before the first frame. */
  readonly score?: BeatorajaScoreInput;
  /** The latest timed judgments, oldest first. */
  readonly recentTimings: readonly { readonly deltaMs: number }[];
}

/**
 * A play skin's judge graph (`judgegraph[].type`) bars: the chart's note kinds (0), the judgment counts so far (1) and
 * the latest judgments' timing histogram (2). `undefined` for another type, without the data, or (1 and 2) before the
 * first frame.
 */
export function resolveBeatorajaPlayJudgeGraph(
  type: number,
  input: BeatorajaPlayJudgeGraphInput,
): readonly number[] | undefined {
  if (type === 0) return input.breakdown !== undefined ? beatorajaNoteBreakdownBars(input.breakdown) : undefined;
  if (input.score === undefined) return undefined;
  switch (type) {
    case 1:
      return beatorajaJudgeCountBars(input.score);
    case 2:
      return beatorajaTimingHistogram(input.recentTimings);
    default:
      return undefined;
  }
}

/**
 * The judge-state graph (`judgegraph[].type` 1 on a play skin, `SkinNoteDistributionGraph` TYPE_JUDGE): per second of
 * chart time, how many of its notes are not judged yet and how many were judged PERFECT, GREAT, GOOD, BAD and POOR
 * (`[unjudged, pg, gr, gd, bd, pr]`), drawn against `maxCount` across `totalMs`.
 */
export interface BeatorajaJudgeStateGraph {
  readonly buckets: readonly (readonly number[])[];
  readonly maxCount: number;
  readonly totalMs: number;
}

/**
 * The judge-state graph of a chart before any judgment, from its note distribution (per second, the seven note
 * categories of `SkinNoteDistributionGraph`): every judged note (taps and long-note ends, on keys and scratch; not the
 * long-note bodies or mines) waits in its second's first slot. The graph's height is the busiest second rounded up to
 * ten, from 20 to 100. `undefined` for a chart without seconds.
 */
export function createBeatorajaJudgeStateGraph(distribution: {
  readonly buckets: readonly (readonly number[])[];
  readonly totalMs: number;
}): BeatorajaJudgeStateGraph | undefined {
  if (distribution.buckets.length === 0) return undefined;
  let busiest = 0;
  const buckets = distribution.buckets.map((bucket) => {
    // SCRATCH_LN_END (0), SCRATCH_NORMAL (2), KEY_LN_END (3) and KEY_NORMAL (5) are judged; long-note bodies (1, 4) and
    // mines (6) are not.
    const judged = (bucket[0] ?? 0) + (bucket[2] ?? 0) + (bucket[3] ?? 0) + (bucket[5] ?? 0);
    if (judged > busiest) busiest = judged;
    return [judged, 0, 0, 0, 0, 0];
  });
  return {
    buckets,
    maxCount: Math.max(20, Math.min(100, Math.ceil(busiest / 10) * 10)),
    totalMs: distribution.totalMs,
  };
}

/** A judgment's slot in the judge-state graph (`Note.STATE_*`): 1 PERFECT … 4 BAD, 5 POOR or MISS; 0 for none. */
export function beatorajaJudgeStateSlot(judge: string): number {
  switch (judge.toUpperCase()) {
    case 'PERFECT':
      return 1;
    case 'GREAT':
      return 2;
    case 'GOOD':
      return 3;
    case 'BAD':
      return 4;
    case 'POOR':
    case 'MISS':
      return 5;
    default:
      return 0;
  }
}

/**
 * Where a judgment moves a note in the judge-state graph: out of the unjudged slot of the second its note sits in
 * (`noteMs` of chart time: the judgment's time less its offset) into the judgment's slot. `undefined` when the judgment
 * is of no slot, falls outside the chart, or its second has no unjudged note left.
 */
export function resolveBeatorajaJudgeStateMove(
  graph: BeatorajaJudgeStateGraph,
  judge: string,
  noteMs: number,
): { readonly bucket: number; readonly slot: number } | undefined {
  const slot = beatorajaJudgeStateSlot(judge);
  if (slot < 1) return undefined;
  const bucket = Math.floor(noteMs / 1000);
  if (bucket < 0 || bucket >= graph.buckets.length) return undefined;
  return graph.buckets[bucket]![0]! > 0 ? { bucket, slot } : undefined;
}

/** How long (ms) a lane's latest judgment shows on its key beam and bomb images (refs 500-519). */
export const BEATORAJA_LANE_JUDGE_WINDOW_MS = 250;

/**
 * The side and lane a lane-judgment ref (`value_judge`, 500-509 for 1P and 510-519 for 2P; lane 0 the scratch) names,
 * or `undefined` for another ref.
 */
export function beatorajaLaneJudgeRef(ref: number): { readonly side: 1 | 2; readonly lane: number } | undefined {
  if (ref >= JUDGE_LANE_REF_1P_BASE && ref < JUDGE_LANE_REF_1P_BASE + JUDGE_LANE_REF_RANGE) {
    return { side: 1, lane: ref - JUDGE_LANE_REF_1P_BASE };
  }
  if (ref >= JUDGE_LANE_REF_2P_BASE && ref < JUDGE_LANE_REF_2P_BASE + JUDGE_LANE_REF_RANGE) {
    return { side: 2, lane: ref - JUDGE_LANE_REF_2P_BASE };
  }
  return undefined;
}

/**
 * The image a lane-judgment ref picks: the latest judgment's place in beatoraja's order plus one (1 PERFECT … 6 MISS)
 * for {@link BEATORAJA_LANE_JUDGE_WINDOW_MS} after it, else 0. The image list clamps the index, so a two-image key beam
 * lights on any judgment.
 */
export function beatorajaLaneJudgeImage(judgeIndex: number, elapsedMs: number): number {
  if (judgeIndex < 0) return 0;
  return elapsedMs >= 0 && elapsedMs <= BEATORAJA_LANE_JUDGE_WINDOW_MS ? judgeIndex + 1 : 0;
}

/** The width a judge popup's combo digits take: the digit cell and the space after it. */
export interface BeatorajaComboDigitMetric {
  readonly width: number;
  readonly space: number;
}

/** What a play skin's live offsets read. */
export interface BeatorajaPlayOffsetInput {
  /** The 1P lane covers. */
  readonly cover?: LaneCoverState;
  /** The lane's height in skin pixels: a cover moves across it. */
  readonly laneHeight: number;
  /** The combo the judge popup shows, which shifts its word left by half its digits' width. */
  readonly maxCombo: number;
  /** The judge popup's combo digits, per side. */
  readonly comboDigits: { readonly 1: BeatorajaComboDigitMetric; readonly 2: BeatorajaComboDigitMetric };
}

/** The parts of an offset (`BeatorajaSkinOffsetValue`) the play sets. */
export interface BeatorajaLiveOffset {
  x: number;
  y: number;
  a: number;
}

function setOffset(out: BeatorajaLiveOffset, x: number, y: number, a: number): true {
  out.x = x;
  out.y = y;
  out.a = a;
  return true;
}

/**
 * Writes the offset the play sets on one of a play skin's live offset ids into `out` (x, y and alpha; the rest left as
 * they are) and returns `true`, or returns `false` for an id the play does not set:
 *
 * - `OFFSET_LIFT` (3): the LIFT raises the lane by its fraction of the lane height (Y up is negative); not set while
 *   there is no LIFT, so a skin's own offset applies.
 * - `OFFSET_HIDDEN_COVER` (5): HIDDEN+ hides the cover (alpha -255) while off, and lowers its edge by its fraction of
 *   the lane above the LIFT (`LaneRenderer`).
 * - The judge popup's word shift (20001 / 20002, a judge with `shift`): left by half the combo digits' width
 *   (`SkinJudge`).
 */
export function writeBeatorajaPlayOffset(
  id: number,
  input: BeatorajaPlayOffsetInput,
  out: BeatorajaLiveOffset,
): boolean {
  if (id === SYNTHETIC_OFFSET_JUDGE_WORD_SHIFT_1P || id === SYNTHETIC_OFFSET_JUDGE_WORD_SHIFT_2P) {
    const combo = input.maxCombo;
    const digits = combo <= 0 ? 1 : Math.floor(Math.log10(combo)) + 1;
    const { width, space } = input.comboDigits[id === SYNTHETIC_OFFSET_JUDGE_WORD_SHIFT_1P ? 1 : 2];
    return setOffset(out, -((width + space) * digits) / 2, 0, 0);
  }
  if (id === OFFSET_LIFT) {
    const lift = input.cover?.lift ?? 0;
    return lift !== 0 ? setOffset(out, 0, lift * -input.laneHeight, 0) : false;
  }
  if (id === OFFSET_HIDDEN_COVER) {
    if (input.cover === undefined || !input.cover.hiddenOn) return setOffset(out, 0, 0, -255);
    return setOffset(out, 0, resolveLaneCover(input.cover).hidden * -input.laneHeight, 0);
  }
  return false;
}

/** The gauge as a percentage of its maximum (the gauge element's fill); 0 without a gauge. */
export function beatorajaGaugePercent(gauge: BeatorajaGaugeInput | undefined): number {
  return gauge !== undefined ? gaugePercent(gauge) : 0;
}
