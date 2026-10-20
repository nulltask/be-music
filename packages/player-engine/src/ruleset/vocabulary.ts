/**
 * `@be-music/player-engine/ruleset`: the vocabulary hosts, skins and the Leaderboard share about how a play is judged — the
 * judge rulesets and how each plays long notes, the judge windows a play is judged by, the gauge the player picks,
 * clear lamps and BP, the score a play earns (its judgment counts, score rate, DJ Rank and LR2's money score) — and the
 * one rule that lamps a play or a course run.
 */
export * from './clear-lamp.ts';
export * from './gauge-type.ts';
export {
  isRulesetId,
  RULESET_IDS,
  type JudgeWindowSetUs,
  type LongNoteStyle,
  type RulesetId,
  type RulesetWindowTables,
  type WindowPairUs,
} from './definitions.ts';
export { resolveJudgeWindowsMs, type JudgeWindowsMs } from '../core/judge-window.ts';
export {
  computeScoreRate,
  createEmptyScore,
  IIDX_RANK_LABELS,
  resolveDisplayedPoor,
  resolveIIDXRankIndexFromScore,
  resolveIIDXRankLabel,
  resolveLR2MoneyScore,
  type IIDXRankLabel,
  type JudgmentKind,
  type ScoreSummary,
} from './score.ts';
