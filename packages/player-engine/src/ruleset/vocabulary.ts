/**
 * `@be-music/player-engine/ruleset`: the vocabulary hosts, skins and the Leaderboard share about how a play is judged — the
 * judge rulesets and how each plays long notes, the judge windows a play is judged by, the gauge the player picks,
 * clear lamps and BP, the score a play earns (its judgment counts, score rate, DJ Rank and LR2's money score) — and the
 * one rule that lamps a play or a course run.
 */
export * from './clear-lamp.ts';
export * from './gauge-type.ts';
export * from './bmson-total.ts';
export * from './option-source.ts';
export {
  clampCustomJudgeRate,
  DEFAULT_BEATORAJA_CUSTOM_JUDGE,
  isCustomJudgeAssist,
  type BeatorajaCustomJudge,
} from './custom-judge.ts';
export {
  BEATORAJA_PRACTICE_GAUGE_TYPES,
  isRulesetId,
  RULESET_IDS,
  type BeatorajaGaugeCategory,
  type JudgeWindowSetUs,
  type LongNoteStyle,
  type RulesetId,
  type RulesetWindowTables,
  type WindowPairUs,
} from './definitions.ts';
export { resolveJudgeWindowsMs, type JudgeWindowsMs } from '../core/judge-window.ts';
export { resolveChartGaugeType } from './chart-gauge.ts';
export {
  computeScoreRate,
  createEmptyScore,
  _____RANK_LABELS,
  resolveDisplayedPoor,
  resolve____RankIndexFromScore,
  resolve____RankLabel,
  resolveLR2MoneyScore,
  type ____RankLabel,
  type JudgmentKind,
  type ScoreSummary,
} from './score.ts';
