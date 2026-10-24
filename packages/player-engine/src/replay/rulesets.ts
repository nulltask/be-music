/**
 * Replay adapter over the shared ruleset definitions.
 *
 * The tables themselves live in `../ruleset/` so the live engine and the simulator share one source of truth;
 * this module only turns a {@link BeMusicReplay} into the neutral {@link RulesetChartFacts} the tables take, and
 * re-exports the ruleset surface the replay API has always exposed.
 */
import {
  createEmptyRulesetNoteCounts,
  resolveRuleset,
  type RulesetChartFacts,
  type RulesetConfig,
} from '../ruleset/index.ts';
import type { LongNoteMode } from '@be-music/chart-model';
import type { BeMusicReplay, ReplayCourseStage } from './format.ts';
import type { RulesetId, ResolveRulesetOptions, RulesetCourseOptions } from '../ruleset/index.ts';

export * from '../ruleset/index.ts';

/** Derives the ruleset's chart facts from a recorded replay. */
export function rulesetChartFactsFromReplay(replay: BeMusicReplay): RulesetChartFacts {
  const chart = replay.chart;
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
  if (chart.totalUnit !== undefined) facts.totalUnit = chart.totalUnit;
  if (chart.total !== undefined) facts.total = chart.total;
  return facts;
}

/**
 * Resolves the ruleset a recorded play should be re-simulated under. Thin wrapper over {@link resolveRuleset}
 * that supplies the replay's own gauge pick and debug judge-window override.
 */
export function resolveRulesetConfig(
  replay: BeMusicReplay,
  rulesetId: RulesetId,
  options: ResolveRulesetOptions = {},
): RulesetConfig {
  const { course } = replay.play;
  return resolveRuleset(rulesetChartFactsFromReplay(replay), rulesetId, {
    selectedGauge: replay.play.gauge,
    ...(rulesetId === 'beatoraja' && replay.play.gaugeAutoShift !== undefined
      ? { gaugeAutoShift: replay.play.gaugeAutoShift }
      : {}),
    ...(rulesetId === 'beatoraja' && replay.play.judgeAlgorithm !== undefined
      ? { judgeAlgorithm: replay.play.judgeAlgorithm }
      : {}),
    ...(replay.play.judgeWindowOverrideMs !== undefined
      ? { judgeWindowOverrideMs: replay.play.judgeWindowOverrideMs }
      : {}),
    ...(course === undefined ? {} : { course: courseStageRulesetOptions(course) }),
    ...options,
  });
}

/** The ruleset course options a recorded course stage was played under. */
export function courseStageRulesetOptions(course: ReplayCourseStage): RulesetCourseOptions {
  const options: RulesetCourseOptions = { kind: course.kind };
  if (course.gaugeSet !== undefined) options.gaugeSet = course.gaugeSet;
  if (course.judge !== undefined) options.judge = course.judge;
  if (course.carryIn !== undefined) options.initialGauge = course.carryIn.gauge;
  return options;
}

/** The course-wide combo and max combo a recorded course stage starts from (0 / 0 for the first stage). */
export function courseStageCarryCombo(course: ReplayCourseStage): { combo: number; maxCombo: number } {
  const combo = course.carryIn?.combo ?? 0;
  return { combo, maxCombo: Math.max(course.carryIn?.maxCombo ?? 0, combo) };
}
