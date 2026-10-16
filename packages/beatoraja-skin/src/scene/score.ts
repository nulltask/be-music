import { gaugePercent } from '@be-music/scene-model';
import {
  BEATORAJA_NUM,
  BEATORAJA_OP,
  computeGenericRankOp,
  computeJudgeExistOps,
  computeRankOp,
} from '../runtime-ids.ts';
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

/** The EX score in percent of its maximum (twice the judgments); 0 without notes. */
export function beatorajaExScoreRate(score: Pick<BeatorajaScoreInput, 'total' | 'exScore'> | undefined): number {
  const max = (score?.total ?? 0) * 2;
  return max > 0 ? ((score?.exScore ?? 0) / max) * 100 : 0;
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
 * - `POINT` (100) and `SCORE2` (101) show the displayed score; `SCORE_RATE` (102 / 103) the EX score in percent of its
 *   maximum, `TOTAL_RATE` (115 / 116) the displayed score in percent of 1000 per judgment.
 * - The engine has no MISS judgment (beatoraja's empty POOR): `MISS` (420) reads the POOR count, and its early / late
 *   rows (421 / 422) the `MISS` entry of the early / late counts, else POOR's.
 * - `COMBOBREAK` (425) and `BAD_PLUS_POOR_PLUS_MISS` (427) count BAD + POOR, `POOR_PLUS_MISS` (426) POOR.
 */
export function resolveBeatorajaScoreNumber(id: number, input: BeatorajaScoreNumberInput): number | undefined {
  const { score, earlyLate } = input;
  switch (id) {
    case BEATORAJA_NUM.POINT:
    case BEATORAJA_NUM.SCORE2:
      return score?.score ?? 0;
    case BEATORAJA_NUM.SCORE_RATE:
      return Math.floor(beatorajaExScoreRate(score));
    case BEATORAJA_NUM.SCORE_RATE_AFTERDOT:
      return afterDot(beatorajaExScoreRate(score));
    case BEATORAJA_NUM.TOTAL_RATE:
    case BEATORAJA_NUM.TOTAL_RATE_AFTERDOT: {
      const total = score?.total ?? 0;
      const rate = total > 0 ? ((score?.score ?? 0) / (total * 1000)) * 100 : 0;
      return id === BEATORAJA_NUM.TOTAL_RATE ? Math.floor(rate) : afterDot(rate);
    }
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

/** The 10 % EX-score band ops (230-240), lowest first. */
const SCORE_BAND_OPS: readonly number[] = [
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

/** The band op of the EX score's tenth of its maximum (`P1_BAND_0_9` … `P1_BAND_100`). */
function scoreBandOp(exScore: number, maxExScore: number): number {
  if (maxExScore <= 0) return BEATORAJA_OP.P1_BAND_0_9;
  const ratio = exScore / maxExScore;
  if (ratio >= 1) return BEATORAJA_OP.P1_BAND_100;
  for (let band = 9; band >= 1; band -= 1) {
    if (ratio >= band / 10) return SCORE_BAND_OPS[band]!;
  }
  return BEATORAJA_OP.P1_BAND_0_9;
}

/**
 * The "now" rank op (340-347, `NOW_*_1P`) for a 1P rank op (200-207): the same rank in the block beatoraja keeps for
 * the rank being played. Anything else reads `NOW_F_1P`.
 */
function nowRankOp(sideRank: number): number {
  if (sideRank >= BEATORAJA_OP.P1_RANK_AAA && sideRank <= BEATORAJA_OP.P1_RANK_F) {
    return sideRank - BEATORAJA_OP.P1_RANK_AAA + BEATORAJA_OP.NOW_AAA_1P;
  }
  return BEATORAJA_OP.NOW_F_1P;
}

/**
 * The ops a play's running score lights on a play skin, as of the engine's latest frame: the 1P, generic and "now" rank
 * ops, the EX-score band op (230-240) and `P1_BAND_BORDER_OR_MORE` (1240) from 80 % of the EX score on, the
 * judgment-exists ops (2241-2246), and `GAUGE_NOW_AT_MAX_1P` while the gauge is full.
 */
export function resolveBeatorajaPlayScoreOps(
  score: BeatorajaScoreInput,
  gauge: Pick<BeatorajaGaugeInput, 'current' | 'max'> | undefined,
): number[] {
  const maxExScore = score.total * 2;
  const sideRank = computeRankOp(score.exScore, maxExScore, 1);
  const ops = [
    sideRank,
    computeGenericRankOp(score.exScore, maxExScore),
    nowRankOp(sideRank),
    scoreBandOp(score.exScore, maxExScore),
  ];
  if (maxExScore > 0 && score.exScore / maxExScore >= 0.8) ops.push(BEATORAJA_OP.P1_BAND_BORDER_OR_MORE);
  ops.push(...computeJudgeExistOps(score));
  if (gauge !== undefined && gaugePercent(gauge) >= 100) ops.push(BEATORAJA_OP.GAUGE_NOW_AT_MAX_1P);
  return ops;
}
