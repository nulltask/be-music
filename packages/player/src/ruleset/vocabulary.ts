/**
 * `@be-music/player/ruleset`: the vocabulary hosts, skins and the Leaderboard share about how a play is judged — the
 * judge rulesets, the gauge the player picks, clear lamps and BP, the score a play earns (its judgment counts, score
 * rate, DJ Rank and LR2's money score) — and the one rule that lamps a play or a course run.
 */
export * from './clear-lamp.ts';
export * from './gauge-type.ts';
export type { PlaylogRulesetId } from './definitions.ts';
export {
  computeScoreRate,
  createEmptyScore,
  IIDX_RANK_LABELS,
  resolveDisplayedPoor,
  resolveIidxRankIndexFromScore,
  resolveIidxRankLabel,
  resolveLr2MoneyScore,
  type IidxRankLabel,
  type JudgeKind,
  type ScoreSummary,
} from './score.ts';
