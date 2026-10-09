import { type BeMusicJson } from '@be-music/json';
import { resolveJudgeRankPercent } from '../core/judge-window.ts';
import type { LongNoteMode, TimedPlayableNote } from '../playable-notes.ts';
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
}

/** Chart-level long-note mode after `#LNMODE` / bmson `info.ln_type` resolution. */
export function resolveChartLongNoteMode(json: BeMusicJson): LongNoteMode {
  if (json.sourceFormat === 'bms') {
    return json.bms.lnMode === 2 || json.bms.lnMode === 3 ? json.bms.lnMode : 1;
  }
  const lnType = json.bmson.info.lnType;
  return lnType === 2 || lnType === 3 ? lnType : 1;
}

/**
 * Derives the ruleset's chart facts from the engine's own representation. The play-log side has a matching adapter
 * (`rulesetChartFactsFromPlaylog`); both must agree, otherwise a live play and its replay would resolve different
 * rulesets from the same chart.
 */
export function rulesetChartFactsFromChart(
  json: BeMusicJson,
  chart: EngineRulesetChartInput,
  dynamicJudgeRankChanges: ReadonlyArray<{ seconds: number; exRankValue: number }> = [],
): RulesetChartFacts {
  const chartLnMode = resolveChartLongNoteMode(json);
  const notes = createEmptyRulesetNoteCounts();
  const long: Record<LongNoteMode, number> = { 1: 0, 2: 0, 3: 0 };
  let normal = 0;
  for (const note of chart.scorableNotes) {
    const hasTail =
      typeof note.endSeconds === 'number' && Number.isFinite(note.endSeconds) && note.endSeconds > note.seconds;
    if (hasTail) {
      long[note.longNoteMode ?? chartLnMode] += 1;
    } else {
      normal += 1;
    }
  }

  const judgeRank: RulesetChartFacts['judgeRank'] = { percent: resolveJudgeRankPercent(json) };
  const sourceRank = json.metadata.rank;
  if (typeof sourceRank === 'number' && Number.isFinite(sourceRank)) {
    judgeRank.sourceRank = sourceRank;
  }
  const sourceExRank = json.sourceFormat === 'bmson' ? json.bmson.info.judgeRank : json.bms.defExRank;
  if (typeof sourceExRank === 'number' && Number.isFinite(sourceExRank)) {
    judgeRank.sourceExRank = sourceExRank;
  }
  if (dynamicJudgeRankChanges.length > 0) {
    judgeRank.timeline = dynamicJudgeRankChanges.map((change) => ({
      timeUs: Math.round(change.seconds * 1_000_000),
      exRankValue: change.exRankValue,
    }));
  }

  const facts: RulesetChartFacts = {
    sourceFormat: json.sourceFormat === 'bmson' ? 'bmson' : 'bms',
    laneMode: chart.laneDisplayMode,
    lnMode: chartLnMode,
    judgeRank,
    notes: { ...notes, normal, long },
  };
  if (typeof json.metadata.total === 'number' && Number.isFinite(json.metadata.total)) {
    facts.total = json.metadata.total;
  }
  return facts;
}
