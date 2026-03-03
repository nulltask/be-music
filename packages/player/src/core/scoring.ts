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
  scoreAccumulator: number;
}

export const IIDX_EX_SCORE_PER_PGREAT = 2;
export const IIDX_EX_SCORE_PER_GREAT = 1;
export const IIDX_SCORE_MAX = 200000;
const IIDX_SCORE_JUDGE_BASE_MAX = 150000;
const IIDX_SCORE_COMBO_BONUS_MAX = 50000;

export function createScoreTracker(): ScoreTracker {
  return {
    combo: 0,
    scoreAccumulator: 0,
  };
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
  } else {
    tracker.combo = 0;
  }

  const scoreDelta = resolveIidxScoreDelta(judge, summary.total, tracker.combo);
  tracker.scoreAccumulator += scoreDelta;
  summary.score = Math.max(0, Math.min(IIDX_SCORE_MAX, Math.floor(tracker.scoreAccumulator + 1e-9)));
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

function resolveIidxScoreDelta(judge: JudgeKind, totalNotes: number, combo: number): number {
  if (!Number.isFinite(totalNotes) || totalNotes <= 0) {
    return 0;
  }

  const baseUnit = IIDX_SCORE_JUDGE_BASE_MAX / totalNotes;
  let judgeMultiplier = 0;
  if (judge === 'PERFECT') {
    judgeMultiplier = 1.5;
  } else if (judge === 'GREAT') {
    judgeMultiplier = 1;
  } else if (judge === 'GOOD') {
    judgeMultiplier = 0.2;
  }

  if (judgeMultiplier <= 0) {
    return 0;
  }

  const comboUnit = resolveIidxComboScoreUnit(totalNotes);
  const comboStep = Math.min(10, Math.max(0, combo - 1));
  return baseUnit * judgeMultiplier + comboStep * comboUnit;
}

function resolveIidxComboScoreUnit(totalNotes: number): number {
  if (!Number.isFinite(totalNotes) || totalNotes <= 1) {
    return 0;
  }

  const finiteTotalNotes = Math.max(1, Math.floor(totalNotes));
  if (finiteTotalNotes <= 10) {
    const totalBonusSteps = finiteTotalNotes > 1 ? ((finiteTotalNotes - 1) * finiteTotalNotes) / 2 : 0;
    return totalBonusSteps > 0 ? IIDX_SCORE_COMBO_BONUS_MAX / totalBonusSteps : 0;
  }
  return IIDX_SCORE_COMBO_BONUS_MAX / (10 * finiteTotalNotes - 55);
}
