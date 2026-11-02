import type { ChartGameLevel, ChartGaugeExtra, ChartGaugeOptions } from '@be-music/chart-model';
import type { RulesetId } from './definitions.ts';
import { resolveGaugeTypes, type GaugeType } from './gauge-type.ts';

/**
 * Each GAMELEVEL / EXTRA pair as a gauge of the shared vocabulary (#845, docs/adr/0034-chart-authored-gauge-options.md).
 * Read from hitkey's measured nanasigroove table (TOTAL 400): BEGINNER and NORMAL are recovery gauges that never fail
 * (BEGINNER clears from 70 %, NORMAL from 80 %), HYPER fails at 0 % from a 50 % start, DANGER fails on the fifth MISS.
 * EXTRA EASY eases a recovery gauge, EXTRA HARD / VERYHARD turn NORMAL into a survival gauge (80 % / 60 % start, failing
 * at 0 %) and make HYPER harsher, and change nothing on DANGER. The rows pick the ruleset gauge whose behavior is closest;
 * the numbers themselves stay each ruleset's own.
 */
const CHART_GAUGE_TABLE: Readonly<Record<ChartGameLevel, Readonly<Record<ChartGaugeExtra | 'OFF', GaugeType>>>> = {
  BEGINNER: { OFF: 'EASY', EASY: 'ASSIST-EASY', HARD: 'GROOVE', VERYHARD: 'GROOVE' },
  NORMAL: { OFF: 'GROOVE', EASY: 'EASY', HARD: 'HARD', VERYHARD: 'EX-HARD' },
  HYPER: { OFF: 'HARD', EASY: 'HARD', HARD: 'EX-HARD', VERYHARD: 'EX-HARD' },
  DANGER: { OFF: 'DEATH', EASY: 'DEATH', HARD: 'DEATH', VERYHARD: 'DEATH' },
};

/** One step toward GROOVE, for a gauge a ruleset does not have. */
const MILDER: Partial<Record<GaugeType, GaugeType>> = {
  'ASSIST-EASY': 'EASY',
  'EX-HARD': 'HARD',
  DEATH: 'EX-HARD',
};

/**
 * The gauge a chart's GAMELEVEL / EXTRA selects under `ruleset`, or `undefined` when it selects none. An EXTRA without a
 * GAMELEVEL applies to NORMAL, nanasigroove's default. A gauge the ruleset's line-up lacks falls back one step toward
 * GROOVE until it has it: LR2 plays ASSIST EASY as EASY and EX-HARD as HARD; `____` plays DEATH as EX-HARD.
 */
export function resolveChartGaugeType(
  options: ChartGaugeOptions | undefined,
  ruleset: RulesetId,
): GaugeType | undefined {
  if (options === undefined || (options.gameLevel === undefined && options.extra === undefined)) return undefined;
  const available = resolveGaugeTypes(ruleset);
  let gauge: GaugeType | undefined = CHART_GAUGE_TABLE[options.gameLevel ?? 'NORMAL'][options.extra ?? 'OFF'];
  while (gauge !== undefined && !available.includes(gauge)) gauge = MILDER[gauge];
  return gauge;
}
