import { resolveBeatorajaGaugeTypeOps } from './play-ops.ts';
import type { ClearLamp } from '@be-music/player-engine/ruleset';
import type {
  CourseView,
  EarlyLateCount,
  GaugeHistorySample,
  JudgmentKind,
  ScoreHistorySample,
} from '@be-music/player-scene-model';
import type { BeatorajaGaugeState } from '../elements/gauge.ts';
import {
  BEATORAJA_NUM,
  BEATORAJA_OP,
  BEATORAJA_TEXT,
  computeJudgeExistOps,
  computeRankOp,
  computeResultRankOp,
} from '../runtime-ids.ts';
import { beatorajaClearLampOp } from './clear-lamp.ts';
import { resolveBeatorajaCourseStageOps, resolveBeatorajaCourseText } from './course.ts';
import type { BeatorajaEarlyLate, BeatorajaGaugeInput, BeatorajaNoteBreakdown, BeatorajaScoreInput } from './inputs.ts';
import {
  beatorajaJudgeCountBars,
  beatorajaNoteBreakdownBars,
  resolveBeatorajaGaugePolyline,
  resolveBeatorajaGaugeState,
  resolveBeatorajaScorePolyline,
} from './play-graphs.ts';
import { beatorajaGenericRankOps, resolveBeatorajaScoreNumber, type BeatorajaScoreNumberInput } from './score.ts';
import {
  resolveBeatorajaSkinText,
  resolveBeatorajaChartText,
  type BeatorajaSkinTextInput,
  type BeatorajaChartTextInput,
} from './chart-text.ts';

/** What a result skin reads of a run's result: the parts of `PlayResult` it shows (a `PlayResult` is one). */
export interface BeatorajaResultFacts {
  readonly score: BeatorajaScoreInput;
  /** Note POORs alone when the result display folds empty POORs into `score.poor` (LR2). */
  readonly judgedPoor?: number;
  readonly fast?: number;
  readonly slow?: number;
  readonly maxCombo: number;
  /** The final gauge in percent, read when the engine's final gauge is not given. */
  readonly gauge?: number;
  readonly gaugeType?: string;
  /** The gauge's clear border in percent, read with {@link gauge}. */
  readonly gaugeBorder?: number;
  /** The TOTAL the gauge ran on, read with {@link gauge}. */
  readonly gaugeTotal?: number;
  readonly cleared: boolean;
  readonly lamp?: ClearLamp;
  readonly gaugeHistory?: readonly GaugeHistorySample[];
  readonly scoreHistory?: readonly ScoreHistorySample[];
  /** Every timed judgment, oldest first. */
  readonly judgeTimings?: readonly { readonly deltaMs: number; readonly judge: string }[];
  /** The early / late counts, else counted from `judgeTimings`. */
  readonly earlyLate?: BeatorajaEarlyLate;
  /** The course a stage or a course run belongs to. */
  readonly course?: CourseView;
}

/** What a result skin reads. */
export interface BeatorajaResultInput {
  readonly result: BeatorajaResultFacts;
  /** The gauge the play ended on as the engine reports it (its border, TOTAL and type); else the result's gauge. */
  readonly gauge?: BeatorajaGaugeInput;
  /** The chart's `#TOTAL` as written. */
  readonly chartTotal?: number;
  /** The chart's note kinds. */
  readonly breakdown?: BeatorajaNoteBreakdown;
  /** The chart played. */
  readonly chart?: BeatorajaChartTextInput;
  readonly skin?: BeatorajaSkinTextInput;
}

const RESULT_GAUGES = new WeakMap<BeatorajaResultFacts, BeatorajaGaugeInput | undefined>();

/**
 * The final gauge: the engine's, else the result's percentage out of 100 under its gauge type, with its clear border and
 * TOTAL when the result has them.
 */
function resultGauge(input: BeatorajaResultInput): BeatorajaGaugeInput | undefined {
  if (input.gauge !== undefined) return input.gauge;
  const { result } = input;
  if (RESULT_GAUGES.has(result)) return RESULT_GAUGES.get(result);
  const gauge =
    result.gauge !== undefined
      ? {
          current: result.gauge,
          max: 100,
          ...(result.gaugeType !== undefined ? { type: result.gaugeType } : {}),
          ...(result.gaugeBorder !== undefined ? { clearThreshold: result.gaugeBorder } : {}),
          ...(result.gaugeTotal !== undefined ? { effectiveTotal: result.gaugeTotal } : {}),
        }
      : undefined;
  RESULT_GAUGES.set(result, gauge);
  return gauge;
}

const NO_EARLY_LATE: EarlyLateCount = { early: 0, late: 0 };
const TIMING_EARLY_LATE = new WeakMap<readonly { deltaMs: number; judge: string }[], BeatorajaEarlyLate>();

/**
 * The early (< 0 ms) and late (> 0 ms) counts of each judgment among `timings`; a judgment on time counts as neither.
 * There is no `MISS` entry: the engine judges no empty POOR with a timing, so beatoraja's MISS rows read POOR's.
 */
export function beatorajaEarlyLateFromTimings(
  timings: readonly { readonly deltaMs: number; readonly judge: string }[],
): BeatorajaEarlyLate {
  const cached = TIMING_EARLY_LATE.get(timings);
  if (cached !== undefined) return cached;
  const counts: Record<JudgmentKind, { early: number; late: number }> = {
    PERFECT: { ...NO_EARLY_LATE },
    GREAT: { ...NO_EARLY_LATE },
    GOOD: { ...NO_EARLY_LATE },
    BAD: { ...NO_EARLY_LATE },
    POOR: { ...NO_EARLY_LATE },
  };
  for (const timing of timings) {
    const count = counts[timing.judge as JudgmentKind];
    if (count === undefined || timing.deltaMs === 0) continue;
    if (timing.deltaMs < 0) count.early += 1;
    else count.late += 1;
  }
  TIMING_EARLY_LATE.set(timings, counts);
  return counts;
}

/** The mean and the standard deviation (population) of the timings' offsets, in ms; 0 and 0 without any. */
export interface BeatorajaTimingStats {
  readonly mean: number;
  readonly stddev: number;
}

const TIMING_STATS = new WeakMap<readonly { deltaMs: number }[], BeatorajaTimingStats>();

/** The mean and standard deviation of the timings' offsets (numbers 374-377), kept per timing list. */
export function beatorajaTimingStats(timings: readonly { readonly deltaMs: number }[]): BeatorajaTimingStats {
  const cached = TIMING_STATS.get(timings);
  if (cached !== undefined) return cached;
  let stats: BeatorajaTimingStats = { mean: 0, stddev: 0 };
  if (timings.length > 0) {
    let sum = 0;
    for (const timing of timings) sum += timing.deltaMs;
    const mean = sum / timings.length;
    let squares = 0;
    for (const timing of timings) squares += (timing.deltaMs - mean) ** 2;
    stats = { mean, stddev: Math.sqrt(squares / timings.length) };
  }
  TIMING_STATS.set(timings, stats);
  return stats;
}

const NO_TIMINGS: readonly { deltaMs: number; judge: string }[] = [];

function afterDot(value: number): number {
  return Math.floor((value - Math.floor(value)) * 100);
}

const SCORE_NUMBER_INPUTS = new WeakMap<BeatorajaResultInput, BeatorajaScoreNumberInput>();

function scoreNumberInput(input: BeatorajaResultInput): BeatorajaScoreNumberInput {
  let numbers = SCORE_NUMBER_INPUTS.get(input);
  if (numbers === undefined) {
    const { result } = input;
    const gauge = resultGauge(input);
    numbers = {
      score: {
        ...result.score,
        ...(result.judgedPoor !== undefined ? { poor: result.judgedPoor } : {}),
        ...(result.fast !== undefined ? { fast: result.fast } : {}),
        ...(result.slow !== undefined ? { slow: result.slow } : {}),
      },
      ...(gauge !== undefined ? { gauge } : {}),
      // A result shows the run's max combo as its combo too: the running combo has long been reset.
      combo: result.maxCombo,
      maxCombo: result.maxCombo,
      earlyLate: result.earlyLate ?? beatorajaEarlyLateFromTimings(result.judgeTimings ?? NO_TIMINGS),
      ...(input.chartTotal !== undefined ? { chartTotal: input.chartTotal } : {}),
    };
    SCORE_NUMBER_INPUTS.set(input, numbers);
  }
  return numbers;
}

/**
 * A result skin's number (`value[].ref`): the score numbers ({@link resolveBeatorajaScoreNumber}) of the run, the
 * combo (104) as the run's max combo, and the mean and standard deviation of the timings (374-377, as their whole
 * milliseconds and two decimals; the mean without its sign). Every other id reads 0: the best-record, target and rival
 * numbers a result screen authors have no records to read yet.
 */
export function resolveBeatorajaResultNumber(id: number, input: BeatorajaResultInput): number {
  switch (id) {
    case BEATORAJA_NUM.AVERAGE_TIMING:
    case BEATORAJA_NUM.AVERAGE_TIMING_AFTERDOT: {
      const mean = Math.abs(beatorajaTimingStats(input.result.judgeTimings ?? NO_TIMINGS).mean);
      return id === BEATORAJA_NUM.AVERAGE_TIMING ? Math.floor(mean) : afterDot(mean);
    }
    case BEATORAJA_NUM.STDDEV_TIMING:
    case BEATORAJA_NUM.STDDEV_TIMING_AFTERDOT: {
      const { stddev } = beatorajaTimingStats(input.result.judgeTimings ?? NO_TIMINGS);
      return id === BEATORAJA_NUM.STDDEV_TIMING ? Math.floor(stddev) : afterDot(stddev);
    }
    // Number 75 is the best record's max combo on a result screen (LR2), which no record feeds yet.
    case BEATORAJA_NUM.BEST_MAXCOMBO:
      return 0;
    default:
      return resolveBeatorajaScoreNumber(id, scoreNumberInput(input)) ?? 0;
  }
}

/**
 * The ops a result skin lights for a run: the 1P and result rank ops (`RESULT_RANK_ZERO_1P` for an EX score of 0),
 * every generic rank op the EX score reaches ({@link beatorajaGenericRankOps}), `RESULT_CLEAR` or `RESULT_FAIL`, the
 * clear lamp's op (`beatorajaClearLampOp`; NO PLAY without a lamp), the judgment-exists ops and, for a course, its
 * stage ops ({@link resolveBeatorajaCourseStageOps}).
 */
export function resolveBeatorajaResultOps(input: BeatorajaResultInput): number[] {
  const { result } = input;
  const { score } = result;
  const maxExScore = score.total * 2;
  const ops = [
    ...resolveBeatorajaGaugeTypeOps(resultGauge(input)?.type ?? result.gaugeType),
    computeRankOp(score.exScore, maxExScore, 1),
    ...beatorajaGenericRankOps(score),
    computeResultRankOp(score.exScore, maxExScore),
    result.cleared ? BEATORAJA_OP.RESULT_CLEAR : BEATORAJA_OP.RESULT_FAIL,
    beatorajaClearLampOp(result.lamp ?? 'NO_PLAY'),
    ...computeJudgeExistOps(score),
  ];
  if (result.course !== undefined) ops.push(...resolveBeatorajaCourseStageOps(result.course));
  return ops;
}

/**
 * A result skin's text: a course's stage titles (150-159) and, on a course run's result (no stage), the course title as
 * the title and the full title, as beatoraja's `StringPropertyFactory` does for `CourseResult`; else the chart's song
 * texts and the skin's own.
 */
export function resolveBeatorajaResultText(id: number, input: BeatorajaResultInput): string | undefined {
  const course = input.result.course;
  if (course !== undefined) {
    const courseText = resolveBeatorajaCourseText(id, course);
    if (courseText !== undefined) return courseText;
    if (course.stageIndex === undefined && (id === BEATORAJA_TEXT.TITLE || id === BEATORAJA_TEXT.FULLTITLE)) {
      return course.title;
    }
  }
  return resolveBeatorajaChartText(id, input.chart) ?? resolveBeatorajaSkinText(id, input.skin);
}

/** The final gauge as a gauge element draws it ({@link resolveBeatorajaGaugeState}). */
export function resolveBeatorajaResultGaugeState(input: BeatorajaResultInput): BeatorajaGaugeState | undefined {
  return resolveBeatorajaGaugeState(resultGauge(input));
}

/** The final gauge in percent of its maximum; 0 without a gauge. */
export function resolveBeatorajaResultGaugePercent(input: BeatorajaResultInput): number {
  const gauge = resultGauge(input);
  return gauge !== undefined && gauge.max > 0 ? (gauge.current / gauge.max) * 100 : 0;
}

/**
 * A result skin's bar graph as a fill ratio: the final gauge (1, and 6 for 2P) and the EX score rate (7). `undefined`
 * for another type.
 */
export function resolveBeatorajaResultGraphValue(type: number, input: BeatorajaResultInput): number | undefined {
  switch (type) {
    case 1:
    case 6: {
      const gauge = resultGauge(input);
      return gauge !== undefined && gauge.max > 0 ? gauge.current / gauge.max : 0;
    }
    case 7: {
      const max = input.result.score.total * 2;
      return max > 0 ? input.result.score.exScore / max : 0;
    }
    default:
      return undefined;
  }
}

/**
 * A result skin's line graph: the EX score over the chart (110) and the gauge over the chart (107). `undefined` for
 * another type or a graph without samples.
 */
export function resolveBeatorajaResultPolyline(
  type: number,
  input: BeatorajaResultInput,
): readonly { x: number; y: number }[] | undefined {
  switch (type) {
    case 110:
      return resolveBeatorajaScorePolyline(input.result.scoreHistory ?? [], input.result.score.total);
    case 107:
      return resolveBeatorajaGaugePolyline(input.result.gaugeHistory ?? []);
    default:
      return undefined;
  }
}

/**
 * A result skin's judge graph bars: the chart's note kinds (0), the judgment counts (1) and the FAST / SLOW counts (2).
 * `undefined` for another type or without the chart's note kinds.
 */
export function resolveBeatorajaResultJudgeGraph(
  type: number,
  input: BeatorajaResultInput,
): readonly number[] | undefined {
  switch (type) {
    case 0:
      return input.breakdown !== undefined ? beatorajaNoteBreakdownBars(input.breakdown) : undefined;
    case 1:
      return beatorajaJudgeCountBars(input.result.score);
    case 2:
      return [input.result.fast ?? 0, input.result.slow ?? 0];
    default:
      return undefined;
  }
}
