/**
 * Play-log adapter over the shared ruleset definitions.
 *
 * The tables themselves live in `../ruleset/` so the live engine and the simulator share one source of truth;
 * this module only turns a {@link BeMusicPlaylog} into the neutral {@link RulesetChartFacts} the tables take, and
 * re-exports the ruleset surface the play-log API has always exposed.
 */
import {
  createEmptyRulesetNoteCounts,
  resolveRuleset,
  type RulesetChartFacts,
  type RulesetConfig,
} from '../ruleset/index.ts';
import type { LongNoteMode } from '../playable-notes.ts';
import type { BeMusicPlaylog } from './format.ts';
import type { PlaylogRulesetId, ResolveRulesetOptions } from '../ruleset/index.ts';

export * from '../ruleset/index.ts';

/** Derives the ruleset's chart facts from a recorded play-log. */
export function rulesetChartFactsFromPlaylog(playlog: BeMusicPlaylog): RulesetChartFacts {
  const chart = playlog.chart;
  const notes = createEmptyRulesetNoteCounts();
  const long: Record<LongNoteMode, number> = { 1: 0, 2: 0, 3: 0 };
  let normal = 0;
  for (const note of chart.notes) {
    if (note.type === 'normal') {
      normal += 1;
    } else if (note.type === 'long') {
      long[note.lnMode ?? chart.lnMode] += 1;
    }
  }
  const facts: RulesetChartFacts = {
    sourceFormat: chart.sourceFormat,
    laneMode: chart.laneMode,
    lnMode: chart.lnMode,
    judgeRank: chart.judgeRank,
    notes: { ...notes, normal, long },
  };
  if (chart.total !== undefined) facts.total = chart.total;
  return facts;
}

/**
 * Resolves the ruleset a recorded play should be re-simulated under. Thin wrapper over {@link resolveRuleset}
 * that supplies the play-log's own gauge pick and debug judge-window override.
 */
export function resolveRulesetConfig(
  playlog: BeMusicPlaylog,
  rulesetId: PlaylogRulesetId,
  options: ResolveRulesetOptions = {},
): RulesetConfig {
  return resolveRuleset(rulesetChartFactsFromPlaylog(playlog), rulesetId, {
    selectedGauge: playlog.play.gauge,
    ...(playlog.play.judgeWindowOverrideMs !== undefined
      ? { judgeWindowOverrideMs: playlog.play.judgeWindowOverrideMs }
      : {}),
    ...options,
  });
}
