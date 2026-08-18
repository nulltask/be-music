export type JudgeKind = 'PERFECT' | 'GREAT' | 'GOOD' | 'BAD' | 'POOR';

export interface ScoreSummary {
  total: number;
  perfect: number;
  great: number;
  good: number;
  bad: number;
  poor: number;
  exScore: number;
  score: number;
}

export interface ScoreTracker {
  combo: number;
  /** Highest combo reached so far — latched by {@link applyJudgeToSummary}, never reset by BAD / POOR. */
  maxCombo: number;
  /**
   * True when the active ruleset defines LR2's 200000-point "money score". Rulesets without one report EX-SCORE in
   * `ScoreSummary.score` instead — that is what beatoraja shows, and what IIDX has shown since BISTROVER retired
   * its own money score.
   */
  moneyScore: boolean;
}

export const IIDX_EX_SCORE_PER_PGREAT = 2;
export const IIDX_EX_SCORE_PER_GREAT = 1;
/** LR2's money-score ceiling: `(4 × PGREAT) × 50000 / notes` reaches exactly this on a full PGREAT clear. */
export const LR2_MONEY_SCORE_MAX = 200000;
const LR2_MONEY_SCORE_UNIT = 50000;

export function createScoreTracker(options: { moneyScore?: boolean } = {}): ScoreTracker {
  return {
    combo: 0,
    maxCombo: 0,
    moneyScore: options.moneyScore ?? true,
  };
}

export function createEmptyScore(total: number): ScoreSummary {
  return { total, perfect: 0, great: 0, good: 0, bad: 0, poor: 0, exScore: 0, score: 0 };
}

export function computeScoreRate(score: Pick<ScoreSummary, 'total' | 'exScore'>): number {
  if (score.total <= 0) {
    return 0;
  }
  const max = score.total * IIDX_EX_SCORE_PER_PGREAT;
  return Math.max(0, Math.min(1, score.exScore / max));
}

export function resolveIidxRankIndexFromScore(score: Pick<ScoreSummary, 'total' | 'exScore'>): number | undefined {
  if (score.total <= 0) {
    return undefined;
  }
  return resolveIidxRankIndexFromRate(computeScoreRate(score));
}

export function resolveIidxRankIndexFromRate(rate: number): number {
  if (rate >= 8 / 9) return 0;
  if (rate >= 7 / 9) return 1;
  if (rate >= 6 / 9) return 2;
  if (rate >= 5 / 9) return 3;
  if (rate >= 4 / 9) return 4;
  if (rate >= 3 / 9) return 5;
  if (rate >= 2 / 9) return 6;
  return 7;
}

export function resolveIidxRankLabel(exScore: number, total: number): string {
  const rankIndex = resolveIidxRankIndexFromScore({ exScore, total });
  if (rankIndex === undefined) {
    return '-';
  }
  return IIDX_RANK_LABELS[rankIndex]!;
}

export function resolveIidxSelectRankOp(score: Pick<ScoreSummary, 'total' | 'exScore'>): number | undefined {
  const rankIndex = resolveIidxRankIndexFromScore(score);
  return rankIndex === undefined ? undefined : 200 + rankIndex;
}

export function applyJudgeToSummary(summary: ScoreSummary, judge: JudgeKind, tracker: ScoreTracker): void {
  if (judge === 'PERFECT') {
    summary.perfect += 1;
  } else if (judge === 'GREAT') {
    summary.great += 1;
  } else if (judge === 'GOOD') {
    summary.good += 1;
  } else if (judge === 'BAD') {
    summary.bad += 1;
  } else {
    summary.poor += 1;
  }

  const exScoreDelta = resolveExScoreDelta(judge);
  summary.exScore += exScoreDelta;

  if (judge === 'PERFECT' || judge === 'GREAT' || judge === 'GOOD') {
    tracker.combo += 1;
    if (tracker.combo > tracker.maxCombo) {
      tracker.maxCombo = tracker.combo;
    }
  } else {
    tracker.combo = 0;
  }

  summary.score = tracker.moneyScore ? resolveLr2MoneyScore(summary) : summary.exScore;
}

/**
 * LR2's money score: `floor((4×PGREAT + 2×GREAT + GOOD) × 50000 / notes)`, capped at 200000 (OpenLR2
 * `LR2_play.cpp`). Purely a function of the judge tally — no combo bonus, unlike the invented curve this replaced.
 */
export function resolveLr2MoneyScore(summary: Pick<ScoreSummary, 'total' | 'perfect' | 'great' | 'good'>): number {
  const notes = Math.max(1, summary.total);
  const weighted = 4 * summary.perfect + 2 * summary.great + summary.good;
  return Math.min(LR2_MONEY_SCORE_MAX, Math.floor((weighted * LR2_MONEY_SCORE_UNIT) / notes));
}

function resolveExScoreDelta(judge: JudgeKind): number {
  if (judge === 'PERFECT') {
    return IIDX_EX_SCORE_PER_PGREAT;
  }
  if (judge === 'GREAT') {
    return IIDX_EX_SCORE_PER_GREAT;
  }
  return 0;
}

const IIDX_RANK_LABELS = ['AAA', 'AA', 'A', 'B', 'C', 'D', 'E', 'F'] as const;
