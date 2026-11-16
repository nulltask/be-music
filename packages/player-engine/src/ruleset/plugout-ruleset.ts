import type { GaugeSpec, PracticeRules, RulesetConfig, RulesetId, RulesetWindowTables } from './definitions.ts';
import type { RulesetChartFacts } from './facts.ts';
import { resolvePlugoutGauge, resolvePlugoutJudgeRank, resolvePlugoutWindowTables } from './plugout.ts';

/** What `resolveRulesetTables` hands the plugout branch: the per-play choices and its shared helpers. */
export interface PlugoutRulesetParts {
  chart: RulesetChartFacts;
  practice: PracticeRules | undefined;
  gaugeId: string;
  gaugeSource: RulesetId;
  /** The judgments issued: a long note counts twice. */
  noteCount: number;
  effectiveTotal: number;
  overrideBadMs: number | undefined;
  constrain: (tables: RulesetWindowTables) => RulesetWindowTables;
  startPracticeGauge: (spec: GaugeSpec, practice: PracticeRules) => GaugeSpec;
  courseGauge: (total: number, notes: number) => GaugeSpec | undefined;
  shiftGauges: (
    initialGauge: GaugeSpec,
    total: number,
    singleGaugeOf: (id: string) => GaugeSpec,
    notes?: number,
  ) => Pick<RulesetConfig, 'gaugeBank' | 'gaugeFallback'>;
  borrowedGauges: (
    notes: number,
  ) =>
    | (Pick<RulesetConfig, 'gauge' | 'gaugeBank' | 'gaugeFallback' | 'effectiveTotal'> & { gaugeSource: RulesetId })
    | undefined;
}

/**
 * plugout (docs/player-spec.md "plugout"): rank-indexed windows, every long note a CN whose tail is a release, a failed
 * head using up the tail, its own gauges and score. It has no PRACTICE, mines or auto-shift of its own: PRACTICE's gauge
 * and TOTAL apply as they do under AC, and mines and auto-shift follow the shared policies (LR2's, ADR 0019).
 */
export function resolvePlugoutRuleset(parts: PlugoutRulesetParts): RulesetConfig {
  const { chart, practice, gaugeId, gaugeSource, noteCount, effectiveTotal } = parts;
  const tables = parts.constrain(resolvePlugoutWindowTables(resolvePlugoutJudgeRank(chart), parts.overrideBadMs));
  const initialGauge = practice
    ? parts.startPracticeGauge(resolvePlugoutGauge(practice.gauge, effectiveTotal, noteCount), practice)
    : (parts.courseGauge(effectiveTotal, noteCount) ?? resolvePlugoutGauge(gaugeId, effectiveTotal, noteCount));
  return {
    id: 'plugout/0',
    rulesetId: 'plugout',
    windows: tables,
    windowsAt: () => tables,
    // The lane's earliest unjudged note is judged (0x440110).
    selection: 'lowest',
    // A BAD re-runs the press on the next note only when that note is within 3 ms (0x4407c4); charts never stack so.
    multiBad: false,
    ignoreLateBadOnLNHead: false,
    longNoteStyle: 'charge',
    lnEarlyRelease: 'worse-of-head-and-tail',
    pressDuringLongNote: 'ignore',
    longNoteReleaseMarginUs: { note: 0, scratch: 0 },
    // A BAD or missed head is one judgment that uses up the tail too (0x440716, 0x44108d).
    headBadSkipsTail: true,
    scratchHoldsBySource: false,
    comboBreaksOnEmptyPoor: false,
    // plugout has no mines: LR2's policy, as AC imports it.
    mineTrigger: 'press-ahead-or-hold',
    hcnTick: { heldJudge: 0, heldRate: 1, releasedJudge: 5, releasedRate: 1 },
    gaugeSource,
    gauge: initialGauge,
    ...parts.shiftGauges(
      initialGauge,
      effectiveTotal,
      (id) => resolvePlugoutGauge(id, effectiveTotal, noteCount),
      noteCount,
    ),
    noteCount,
    effectiveTotal,
    ...parts.borrowedGauges(noteCount),
    moneyScore: false,
    plugoutScore: true,
    heldChargeTail: { note: 'BAD', scratch: 'PGREAT', earlyRelease: 'BAD' },
    laneSound: 'plugout',
    emptyPoorCountsInPoorDisplay: false,
  };
}
