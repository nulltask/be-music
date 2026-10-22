/**
 * The score vocabulary: the judgment counts and scores of a play, its score rate, its DJ Rank and LR2's money score.
 * Every judge ruleset scores with it, and hosts, skins and the Leaderboard read a result with it
 * (`@be-music/player-engine/ruleset`). The engine's running combo and the trackers that fill a summary stay in `core/scoring`.
 */

export type JudgmentKind = 'PERFECT' | 'GREAT' | 'GOOD' | 'BAD' | 'POOR';

export interface ScoreSummary {
  total: number;
  perfect: number;
  great: number;
  good: number;
  bad: number;
  poor: number;
  /** Empty POOR (空POOR) count — see `PlayerSummary.emptyPoor`. Never a note judgment, so `applyJudgeToSummary`
   * does not touch it; the engine increments it on the empty-POOR path. */
  emptyPoor: number;
  /** LR2 mine hits already included in `poor`; not judgment notes and never a combo break. */
  minePoor?: number;
  exScore: number;
  score: number;
}

export const IIDX_EX_SCORE_PER_PGREAT = 2;
export const IIDX_EX_SCORE_PER_GREAT = 1;
/** LR2's money-score ceiling: `(4 × PGREAT) × 50000 / notes` reaches exactly this on a full PGREAT clear. */
export const LR2_MONEY_SCORE_MAX = 200000;
const LR2_MONEY_SCORE_UNIT = 50000;

export function createEmptyScore(total: number): ScoreSummary {
  return { total, perfect: 0, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0, exScore: 0, score: 0 };
}

/**
 * The POOR figure a ruleset's own result screen shows. LR2 folds empty POORs into it (OpenLR2 `ApplyJudgeNote`
 * increments `playerstat.poor` for the empty-POOR branch, and LR2 exposes no separate stat), so a run judged under
 * LR2 must display the sum to match the real thing. Rulesets that report them apart pass `false`.
 */
export function resolveDisplayedPoor(
  score: Pick<ScoreSummary, 'poor' | 'emptyPoor'>,
  emptyPoorCountsInPoor: boolean,
): number {
  return emptyPoorCountsInPoor ? score.poor + score.emptyPoor : score.poor;
}

export function computeScoreRate(score: Pick<ScoreSummary, 'total' | 'exScore'>): number {
  if (score.total <= 0) {
    return 0;
  }
  const max = score.total * IIDX_EX_SCORE_PER_PGREAT;
  return Math.max(0, Math.min(1, score.exScore / max));
}

export function resolveIIDXRankIndexFromScore(score: Pick<ScoreSummary, 'total' | 'exScore'>): number | undefined {
  if (score.total <= 0) {
    return undefined;
  }
  return resolveIIDXRankIndexFromRate(computeScoreRate(score));
}

export function resolveIIDXRankIndexFromRate(rate: number): number {
  if (rate >= 8 / 9) return 0;
  if (rate >= 7 / 9) return 1;
  if (rate >= 6 / 9) return 2;
  if (rate >= 5 / 9) return 3;
  if (rate >= 4 / 9) return 4;
  if (rate >= 3 / 9) return 5;
  if (rate >= 2 / 9) return 6;
  return 7;
}

export function resolveIIDXRankLabel(exScore: number, total: number): string {
  const rankIndex = resolveIIDXRankIndexFromScore({ exScore, total });
  if (rankIndex === undefined) {
    return '-';
  }
  return IIDX_RANK_LABELS[rankIndex]!;
}

/**
 * LR2's money score: `floor((4×PGREAT + 2×GREAT + GOOD) × 50000 / notes)`, capped at 200000 (OpenLR2
 * `LR2_play.cpp`). Purely a function of the judge tally — no combo bonus, unlike the invented curve this replaced.
 */
export function resolveLR2MoneyScore(summary: Pick<ScoreSummary, 'total' | 'perfect' | 'great' | 'good'>): number {
  const notes = Math.max(1, summary.total);
  const weighted = 4 * summary.perfect + 2 * summary.great + summary.good;
  return Math.min(LR2_MONEY_SCORE_MAX, Math.floor((weighted * LR2_MONEY_SCORE_UNIT) / notes));
}

/** The DJ Ranks (DJ LEVEL) on the IIDX ninths, best first: the labels `resolveIIDXRankLabel` returns. */
export const IIDX_RANK_LABELS = ['AAA', 'AA', 'A', 'B', 'C', 'D', 'E', 'F'] as const;
export type IIDXRankLabel = (typeof IIDX_RANK_LABELS)[number];
