import { resolveChart, resolveChartLongNoteMode, type LongNoteMode, type ResolvedChart } from '@be-music/chart';
import { type BeMusicJSON } from '@be-music/json';
import { resolveJudgeRankPercent } from '../core/judge-window.ts';
import type { TimedPlayableNote } from '../playable-notes.ts';
import { createEmptyRulesetNoteCounts, type RulesetChartFacts } from './facts.ts';

/**
 * Chart-side inputs the engine already has when it builds a play: the resolved JSON plus the prepared note arrays.
 * Structurally a subset of `PreparedPlaybackChartData`, so the engine hands its bundle over verbatim.
 */
export interface EngineRulesetChartInput {
  /** Scorable notes only — free-zone, mine, and invisible notes are excluded upstream. */
  scorableNotes: ReadonlyArray<TimedPlayableNote>;
  /** `resolveLaneDisplayMode` output — picks beatoraja's per-mode window tables. */
  laneDisplayMode: string;
  /** The resolved chart the notes came from (`PreparedPlaybackChartData.resolvedChart`); resolved from `json` if absent. */
  resolvedChart?: ResolvedChart;
}

/**
 * The judge-rank inputs a ruleset reads, as `RulesetChartFacts` / `PlaylogChart` record them: the LR2-axis percent and
 * the chart's own `#RANK` / `#DEFEXRANK` (bmson `judge_rank`) from the resolved chart.
 */
export function resolveChartJudgeRankFacts(
  json: BeMusicJSON,
  resolved: ResolvedChart,
): { percent: number; sourceRank?: number; sourceExRank?: number } {
  const judgeRank: { percent: number; sourceRank?: number; sourceExRank?: number } = {
    percent: resolveJudgeRankPercent(json),
  };
  if (resolved.judgeRank.rank !== undefined) {
    judgeRank.sourceRank = resolved.judgeRank.rank;
  }
  if (resolved.judgeRank.exRank !== undefined) {
    judgeRank.sourceExRank = resolved.judgeRank.exRank;
  }
  return judgeRank;
}

/** Chart-level long-note mode after `#LNMODE` / bmson `info.ln_type` resolution (`@be-music/chart`). */
export { resolveChartLongNoteMode };

/**
 * Derives the ruleset's chart facts from the engine's own representation. The play log side has a matching adapter
 * (`rulesetChartFactsFromPlaylog`); both must agree, otherwise a live play and its replay would resolve different
 * rulesets from the same chart.
 */
export function rulesetChartFactsFromChart(
  json: BeMusicJSON,
  chart: EngineRulesetChartInput,
  dynamicJudgeRankChanges: ReadonlyArray<{ seconds: number; exRankValue: number }> = [],
  stageRanks: ReadonlyArray<{ seconds: number; rank: number; table: 'chart' | 'lr2-nonstop' }> = [],
): RulesetChartFacts {
  const resolved = chart.resolvedChart ?? resolveChart(json);
  const chartLNMode = resolved.lnMode;
  const notes = createEmptyRulesetNoteCounts();
  const long: Record<LongNoteMode, number> = { 1: 0, 2: 0, 3: 0 };
  let normal = 0;
  for (const note of chart.scorableNotes) {
    const hasTail =
      typeof note.endSeconds === 'number' && Number.isFinite(note.endSeconds) && note.endSeconds > note.seconds;
    if (hasTail) {
      long[note.longNoteMode ?? chartLNMode] += 1;
    } else {
      normal += 1;
    }
  }

  const judgeRank: RulesetChartFacts['judgeRank'] = resolveChartJudgeRankFacts(json, resolved);
  if (dynamicJudgeRankChanges.length > 0) {
    judgeRank.timeline = dynamicJudgeRankChanges.map((change) => ({
      timeUs: Math.round(change.seconds * 1_000_000),
      exRankValue: change.exRankValue,
    }));
  }
  if (stageRanks.length > 0) {
    judgeRank.stageRanks = stageRanks.map((change) => ({
      timeUs: Math.round(change.seconds * 1_000_000),
      rank: change.rank,
      table: change.table,
    }));
  }

  const facts: RulesetChartFacts = {
    sourceFormat: json.sourceFormat === 'bmson' ? 'bmson' : 'bms',
    laneMode: chart.laneDisplayMode,
    lnMode: chartLNMode,
    judgeRank,
    notes: { ...notes, normal, long },
  };
  if (resolved.total.value !== undefined) {
    facts.total = resolved.total.value;
  }
  return facts;
}
