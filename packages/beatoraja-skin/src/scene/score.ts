import { gaugePercent } from '@be-music/scene-model';
import { BEATORAJA_NUM, BEATORAJA_OP, computeJudgeExistOps } from '../runtime-ids.ts';
import type { BeatorajaEarlyLate, BeatorajaGaugeInput, BeatorajaScoreInput } from './inputs.ts';

/** What the score numbers a play skin and a result skin share read. */
export interface BeatorajaScoreNumberInput {
  /** The judgment counts and scores; absent before the engine reports any (they read 0). */
  readonly score?: BeatorajaScoreInput;
  readonly gauge?: BeatorajaGaugeInput;
  /** The combo shown as number 104: the running combo during a play. */
  readonly combo: number;
  /** The longest combo (number 105). */
  readonly maxCombo: number;
  readonly earlyLate?: BeatorajaEarlyLate;
  /** The chart's `#TOTAL` as written, which number 368 shows until a gauge reports the TOTAL it runs on. */
  readonly chartTotal?: number;
}

/** The integer part of a percentage and its first two decimals, as beatoraja's `*_AFTERDOT` pairs show it. */
function afterDot(percent: number): number {
  return Math.floor((percent - Math.floor(percent)) * 100);
}

/** A rate as beatoraja's numbers draw it: the whole percent and its two digits after the dot. */
export interface BeatorajaRate {
  readonly whole: number;
  readonly afterDot: number;
}

/**
 * The EX score as a percentage of the highest one `notes` notes can give (beatoraja `ScoreDataProperty`: `exscore /
 * (notes × 2)`, 100 % for no notes), truncated to hundredths of a percent as the `*_RATE` / `*_AFTERDOT` pairs draw it.
 */
export function beatorajaScoreRate(exScore: number, notes: number): BeatorajaRate {
  if (notes <= 0) return { whole: 100, afterDot: 0 };
  const hundredths = Math.floor((exScore * 10_000) / (notes * 2));
  return { whole: Math.floor(hundredths / 100), afterDot: hundredths % 100 };
}

/** The notes judged so far: every PERFECT … POOR (an empty POOR judges no note). */
export function beatorajaNotesJudged(
  score: Pick<BeatorajaScoreInput, 'perfect' | 'great' | 'good' | 'bad' | 'poor'>,
): number {
  return score.perfect + score.great + score.good + score.bad + score.poor;
}

/**
 * The chart TOTAL readout (number 368, `chart_totalgauge`). beatoraja reads it after `BMSPlayerRule.validate`, i.e. the
 * TOTAL the gauge actually runs on — a bmson `total` is a percentage of the ruleset's default TOTAL and a missing
 * `#TOTAL` is that default — so the gauge's `effectiveTotal` wins whenever a gauge reports one. Without one (before the
 * first frame) the chart header is shown as written. Floored, since the readout has no fraction digits; `undefined`
 * when there is nothing to show.
 */
export function beatorajaChartTotalReadout(
  gauge: Pick<BeatorajaGaugeInput, 'effectiveTotal'> | undefined,
  chartTotal: number | undefined,
): number | undefined {
  const effectiveTotal = gauge?.effectiveTotal;
  if (typeof effectiveTotal === 'number' && Number.isFinite(effectiveTotal) && effectiveTotal > 0) {
    return Math.floor(effectiveTotal);
  }
  return typeof chartTotal === 'number' && Number.isFinite(chartTotal) ? Math.floor(chartTotal) : undefined;
}

function early(earlyLate: BeatorajaEarlyLate | undefined, judge: keyof NonNullable<BeatorajaEarlyLate>): number {
  return earlyLate?.[judge]?.early ?? 0;
}

function late(earlyLate: BeatorajaEarlyLate | undefined, judge: keyof NonNullable<BeatorajaEarlyLate>): number {
  return earlyLate?.[judge]?.late ?? 0;
}

/**
 * The score numbers a play skin and a result skin share (`IntegerPropertyFactory`): the score and its rates, the
 * combo, the judgment counts and their early / late split, the gauge and the chart TOTAL. `undefined` for an id that is
 * not one of them.
 *
 * - `POINT` (100) shows the displayed score and `SCORE2` (101) the EX score (beatoraja's `createScoreProperty`, LR2's
 *   number 101); `TOTAL_RATE` (115 / 116) the EX score as a rate of every note ({@link beatorajaScoreRate}), and so does
 *   `SCORE_RATE` (102 / 103) here: a finished run's rate, as beatoraja's result reads it (a play reads it over the notes
 *   judged so far, `resolveBeatorajaPlayNumber`). The rates read 0 before the engine reports a score.
 * - The engine has no MISS judgment (beatoraja's empty POOR): `MISS` (420) reads the POOR count, and its early / late
 *   rows (421 / 422) the `MISS` entry of the early / late counts, else POOR's.
 * - `COMBOBREAK` (425) and `BAD_PLUS_POOR_PLUS_MISS` (427) count BAD + POOR, `POOR_PLUS_MISS` (426) POOR.
 */
export function resolveBeatorajaScoreNumber(id: number, input: BeatorajaScoreNumberInput): number | undefined {
  const { score, earlyLate } = input;
  switch (id) {
    case BEATORAJA_NUM.POINT:
      return score?.score ?? 0;
    case BEATORAJA_NUM.SCORE2:
      return score?.exScore ?? 0;
    case BEATORAJA_NUM.SCORE_RATE:
    case BEATORAJA_NUM.TOTAL_RATE:
      return score !== undefined ? beatorajaScoreRate(score.exScore, score.total).whole : 0;
    case BEATORAJA_NUM.SCORE_RATE_AFTERDOT:
    case BEATORAJA_NUM.TOTAL_RATE_AFTERDOT:
      return score !== undefined ? beatorajaScoreRate(score.exScore, score.total).afterDot : 0;
    case BEATORAJA_NUM.COMBO:
      return input.combo;
    case BEATORAJA_NUM.MAXCOMBO_LIVE:
      return input.maxCombo;
    case BEATORAJA_NUM.TOTALNOTES:
    case BEATORAJA_NUM.TOTALNOTES_LIVE:
      return score?.total ?? 0;
    case BEATORAJA_NUM.GROOVEGAUGE:
    case BEATORAJA_NUM.GROOVEGAUGE_AFTERDOT: {
      const percent = input.gauge !== undefined ? gaugePercent(input.gauge) : 0;
      return id === BEATORAJA_NUM.GROOVEGAUGE ? Math.floor(percent) : afterDot(percent);
    }
    case BEATORAJA_NUM.BMS_TOTAL:
      return beatorajaChartTotalReadout(input.gauge, input.chartTotal) ?? 0;
    case BEATORAJA_NUM.PERFECT:
      return score?.perfect ?? 0;
    case BEATORAJA_NUM.GREAT:
      return score?.great ?? 0;
    case BEATORAJA_NUM.GOOD:
      return score?.good ?? 0;
    case BEATORAJA_NUM.BAD:
      return score?.bad ?? 0;
    case BEATORAJA_NUM.POOR:
    case BEATORAJA_NUM.MISS:
    case BEATORAJA_NUM.POOR_PLUS_MISS:
      return score?.poor ?? 0;
    case BEATORAJA_NUM.COMBOBREAK:
    case BEATORAJA_NUM.BAD_PLUS_POOR_PLUS_MISS:
      return (score?.bad ?? 0) + (score?.poor ?? 0);
    case BEATORAJA_NUM.TOTALEARLY:
      return score?.fast ?? 0;
    case BEATORAJA_NUM.TOTALLATE:
      return score?.slow ?? 0;
    case BEATORAJA_NUM.EARLY_PERFECT:
      return early(earlyLate, 'PERFECT');
    case BEATORAJA_NUM.LATE_PERFECT:
      return late(earlyLate, 'PERFECT');
    case BEATORAJA_NUM.EARLY_GREAT:
      return early(earlyLate, 'GREAT');
    case BEATORAJA_NUM.LATE_GREAT:
      return late(earlyLate, 'GREAT');
    case BEATORAJA_NUM.EARLY_GOOD:
      return early(earlyLate, 'GOOD');
    case BEATORAJA_NUM.LATE_GOOD:
      return late(earlyLate, 'GOOD');
    case BEATORAJA_NUM.EARLY_BAD:
      return early(earlyLate, 'BAD');
    case BEATORAJA_NUM.LATE_BAD:
      return late(earlyLate, 'BAD');
    case BEATORAJA_NUM.EARLY_POOR:
      return early(earlyLate, 'POOR');
    case BEATORAJA_NUM.LATE_POOR:
      return late(earlyLate, 'POOR');
    case BEATORAJA_NUM.EARLY_MISS:
      return early(earlyLate, earlyLate?.MISS !== undefined ? 'MISS' : 'POOR');
    case BEATORAJA_NUM.LATE_MISS:
      return late(earlyLate, earlyLate?.MISS !== undefined ? 'MISS' : 'POOR');
    default:
      return undefined;
  }
}

/** The 1P gauge range ops (230-240: 0-9 % … 90-99 %, 100 %), lowest first. */
const GAUGE_RANGE_OPS: readonly number[] = [
  BEATORAJA_OP.P1_BAND_0_9,
  BEATORAJA_OP.P1_BAND_10_19,
  BEATORAJA_OP.P1_BAND_20_29,
  BEATORAJA_OP.P1_BAND_30_39,
  BEATORAJA_OP.P1_BAND_40_49,
  BEATORAJA_OP.P1_BAND_50_59,
  BEATORAJA_OP.P1_BAND_60_69,
  BEATORAJA_OP.P1_BAND_70_79,
  BEATORAJA_OP.P1_BAND_80_89,
  BEATORAJA_OP.P1_BAND_90_99,
  BEATORAJA_OP.P1_BAND_100,
];

/**
 * The gauge range op of a gauge: its tenth of the maximum, the full gauge on its own (beatoraja
 * `BooleanPropertyFactory.GaugeDrawCondition`: `value >= range × 10 % of max && value < (range + 1) × 10 %`; LR2's
 * "1P gauge 0-9 %" … "100 %").
 */
function gaugeRangeOp(gauge: Pick<BeatorajaGaugeInput, 'current' | 'max'>): number {
  const range = Math.floor(gaugePercent(gauge) / 10);
  return GAUGE_RANGE_OPS[Math.max(0, Math.min(GAUGE_RANGE_OPS.length - 1, range))]!;
}

/** The 27ths of the highest EX score each rank starts at, AAA first (beatoraja `BooleanPropertyFactory`). */
const RANK_BORDERS_IN_27THS = [24, 21, 18, 15, 12, 9, 6, 0] as const;

/**
 * The 1P rank op (200 AAA … 207 F) of a play: the rank of the EX score over the notes judged so far, as beatoraja's
 * `createNowRank` reads `ScoreDataProperty.nowrate` (`exscore / (notes judged × 2)`, 100 % before the first note, so a
 * play starts on AAA); none on a chart without notes. The rate is compared with each border exactly, in 27ths.
 */
function beatorajaPlayRankOp(score: BeatorajaScoreInput): number | undefined {
  if (score.total <= 0) return undefined;
  const judged = beatorajaNotesJudged(score);
  const index =
    judged === 0 ? 0 : RANK_BORDERS_IN_27THS.findIndex((border) => score.exScore * 27 >= border * judged * 2);
  return BEATORAJA_OP.P1_RANK_AAA + index;
}

/** The generic rank ops (220 AAA … 227 F), AAA first, in the order of {@link RANK_BORDERS_IN_27THS}. */
const GENERIC_RANK_OPS = [
  BEATORAJA_OP.RANK_AAA,
  BEATORAJA_OP.RANK_AA,
  BEATORAJA_OP.RANK_A,
  BEATORAJA_OP.RANK_B,
  BEATORAJA_OP.RANK_C,
  BEATORAJA_OP.RANK_D,
  BEATORAJA_OP.RANK_E,
  BEATORAJA_OP.RANK_F,
] as const;

/**
 * The generic rank ops (220 AAA … 227 F) a score lights: every rank its EX score reaches over the chart's notes, as
 * beatoraja's `BooleanPropertyFactory` asks `ScoreDataProperty.qualifyRank` (`rate >= border / 27`, with
 * `rate = exscore / (notes × 2)`), so an AAA lights all eight and any score on a chart with notes lights F. The rate is
 * compared with each border exactly, in 27ths. None on a chart without notes. `computeGenericRankOp` names one rank,
 * the highest of these.
 */
export function beatorajaGenericRankOps(score: Pick<BeatorajaScoreInput, 'exScore' | 'total'>): number[] {
  if (score.total <= 0) return [];
  const ops: number[] = [];
  RANK_BORDERS_IN_27THS.forEach((border, index) => {
    if (score.exScore * 27 >= border * score.total * 2) ops.push(GENERIC_RANK_OPS[index]!);
  });
  return ops;
}

/**
 * The "now" rank op (340-347, `NOW_*_1P`) for a 1P rank op (200-207): the same rank in the block beatoraja keeps for
 * the rank being played (both read `createNowRank`).
 */
function nowRankOp(sideRank: number): number {
  return sideRank - BEATORAJA_OP.P1_RANK_AAA + BEATORAJA_OP.NOW_AAA_1P;
}

/**
 * The ops a play's running score and gauge light on a play skin, as of the engine's latest frame: the 1P and "now"
 * rank ops over the notes judged so far ({@link beatorajaPlayRankOp}), the generic rank ops the EX score reaches
 * ({@link beatorajaGenericRankOps}) and its judgment-exists ops (2241-2246); and with a gauge, its range op (230-240),
 * `P1_BAND_BORDER_OR_MORE` (1240) while the gauge would clear (beatoraja `Gauge.isQualified`: above 0 and at its border
 * or more), and `GAUGE_NOW_AT_MAX_1P` while it is full.
 */
export function resolveBeatorajaPlayScoreOps(
  score: BeatorajaScoreInput,
  gauge: Pick<BeatorajaGaugeInput, 'current' | 'max' | 'clearThreshold'> | undefined,
): number[] {
  const sideRank = beatorajaPlayRankOp(score);
  const ops = [
    ...(sideRank !== undefined ? [sideRank, nowRankOp(sideRank)] : []),
    ...beatorajaGenericRankOps(score),
    ...computeJudgeExistOps(score),
  ];
  if (gauge !== undefined && gauge.max > 0) {
    ops.push(gaugeRangeOp(gauge));
    if (gauge.current > 0 && gauge.current >= (gauge.clearThreshold ?? 0)) {
      ops.push(BEATORAJA_OP.P1_BAND_BORDER_OR_MORE);
    }
    if (gaugePercent(gauge) >= 100) ops.push(BEATORAJA_OP.GAUGE_NOW_AT_MAX_1P);
  }
  return ops;
}
