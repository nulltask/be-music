/**
 * Replay adapter over the shared ruleset definitions.
 *
 * The tables themselves live in `../ruleset/` so the live engine and the simulator share one source of truth;
 * this module only turns a {@link BeMusicReplay} into the neutral {@link RulesetChartFacts} the tables take, and
 * re-exports the ruleset surface the replay API has always exposed.
 */
import { resolveAutoScratchChannels } from '../core/auto-scratch.ts';
import { resolveChartJudgeOption } from '../ruleset/chart-judge.ts';
import { resolveScratchChannels } from './scratch-channels.ts';
import {
  resolveRuleset,
  type RulesetChartFacts,
  type RulesetConfig,
  type RulesetNoteCounts,
} from '../ruleset/index.ts';
import type { LongNoteMode } from '@be-music/chart-model';
import type { BeMusicReplay, ReplayCourseStage } from './format.ts';
import type { RulesetId, ResolveRulesetOptions, RulesetCourseOptions } from '../ruleset/index.ts';

export * from '../ruleset/index.ts';

/** Derives the ruleset's chart facts from a recorded replay. */
export function rulesetChartFactsFromReplay(replay: BeMusicReplay): RulesetChartFacts {
  const chart = replay.chart;
  const counts = createTally();
  for (const note of chart.notes) {
    if (note.type === 'normal') {
      counts.normal += 1;
    } else if (note.type === 'long') {
      counts.long[note.lnMode ?? chart.lnMode] += 1;
    }
  }
  return createChartFacts(replay, counts);
}

function createChartFacts(replay: BeMusicReplay, { normal, long }: ReplayNoteTally): RulesetChartFacts {
  const chart = replay.chart;
  const facts: RulesetChartFacts = {
    sourceFormat: chart.sourceFormat,
    laneMode: chart.laneMode,
    lnMode: chart.lnMode,
    judgeRank: chart.judgeRank,
    notes: { normal, long },
  };
  if (chart.totalUnit !== undefined) facts.totalUnit = chart.totalUnit;
  if (chart.total !== undefined) facts.total = chart.total;
  return facts;
}

/** Shared empty set for plays without AUTO SCRATCH. */
const NO_CHANNELS: ReadonlySet<string> = new Set();

interface ReplayNoteTally {
  normal: number;
  long: Record<LongNoteMode, number>;
}

function createTally(): ReplayNoteTally {
  return { normal: 0, long: { 1: 0, 2: 0, 3: 0 } };
}

function tallyCounts({ normal, long }: ReplayNoteTally): RulesetNoteCounts | undefined {
  return normal + long[1] + long[2] + long[3] > 0 ? { normal, long } : undefined;
}

/**
 * The ruleset inputs a recorded play's notes give, counted in one pass: the chart's facts, the notes AUTO SCRATCH played
 * in a manual play, and the notes plugout leaves out of its count (`ReplayNote.uncounted`) other than AUTO SCRATCH's.
 */
function tallyReplayNotes(replay: BeMusicReplay): {
  facts: RulesetChartFacts;
  autoScratchNotes: RulesetNoteCounts | undefined;
  uncountedNotes: RulesetNoteCounts | undefined;
} {
  const chart = replay.chart;
  const auto =
    replay.play.mode === 'auto'
      ? NO_CHANNELS
      : resolveAutoScratchChannels(replay.play, resolveScratchChannels(chart.laneMode));
  const all = createTally();
  const autoScratch = createTally();
  const uncounted = createTally();
  for (const note of chart.notes) {
    let tally: ReplayNoteTally | undefined;
    if (auto.size > 0 && auto.has(note.channel)) tally = autoScratch;
    else if (note.uncounted === true) tally = uncounted;
    if (note.type === 'normal') {
      all.normal += 1;
      if (tally !== undefined) tally.normal += 1;
    } else if (note.type === 'long') {
      const mode = note.lnMode ?? chart.lnMode;
      all.long[mode] += 1;
      if (tally !== undefined) tally.long[mode] += 1;
    }
  }
  return {
    facts: createChartFacts(replay, all),
    autoScratchNotes: tallyCounts(autoScratch),
    uncountedNotes: tallyCounts(uncounted),
  };
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
  const { facts, autoScratchNotes, uncountedNotes } = tallyReplayNotes(replay);
  return resolveRuleset(facts, rulesetId, {
    ...(autoScratchNotes !== undefined ? { autoScratchNotes } : {}),
    ...(uncountedNotes !== undefined ? { uncountedNotes } : {}),
    selectedGauge: replay.play.gauge,
    // Gauge auto-shift is carried (ADR 0019): it shifts along the target ruleset's own ladder.
    ...(replay.play.bottomShiftableGauge !== undefined
      ? { bottomShiftableGauge: replay.play.bottomShiftableGauge }
      : {}),
    ...(replay.play.gaugeAutoShift !== undefined ? { gaugeAutoShift: replay.play.gaugeAutoShift } : {}),
    ...(rulesetId === 'beatoraja' && replay.play.judgeAlgorithm !== undefined
      ? { judgeAlgorithm: replay.play.judgeAlgorithm }
      : {}),
    // GAMBOL is LR2's own; another ruleset re-judges the inputs with its own windows.
    ...(rulesetId === 'lr2' && replay.play.lr2Gambol !== undefined ? { lr2Gambol: replay.play.lr2Gambol } : {}),
    ...(rulesetId === 'beatoraja' && replay.play.customJudge !== undefined
      ? { customJudge: replay.play.customJudge }
      : {}),
    ...(replay.play.judgeWindowOverrideMs !== undefined
      ? { judgeWindowOverrideMs: replay.play.judgeWindowOverrideMs }
      : {}),
    ...(course === undefined ? {} : { course: courseStageRulesetOptions(course) }),
    ...resolveChartJudgeOption(replay.chart.chartPlayOptions),
    ...options,
    // A legacy replay always uses compatibility, regardless of the viewer's current choice.
    bmsonTotalMode: replay.play.bmsonTotalMode ?? 'beatoraja',
  });
}

/** The ruleset course options a recorded course stage was played under. */
export function courseStageRulesetOptions(course: ReplayCourseStage): RulesetCourseOptions {
  const options: RulesetCourseOptions = { kind: course.kind };
  if (course.gaugeSet !== undefined) options.gaugeSet = course.gaugeSet;
  if (course.judge !== undefined) options.judge = course.judge;
  if (course.carryIn !== undefined) options.initialGauge = course.carryIn.gauge;
  if (course.carryIn?.gauges !== undefined) options.initialGauges = course.carryIn.gauges;
  return options;
}

/** The course-wide combo and max combo a recorded course stage starts from (0 / 0 for the first stage). */
export function courseStageCarryCombo(course: ReplayCourseStage): { combo: number; maxCombo: number } {
  const combo = course.carryIn?.combo ?? 0;
  return { combo, maxCombo: Math.max(course.carryIn?.maxCombo ?? 0, combo) };
}
