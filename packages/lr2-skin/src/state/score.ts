import type { ScoreSummary } from '@be-music/player/core/scoring';
import { LR2_NUM } from '../ids/index.ts';

/** `count` over `of` as LR2 draws a percentage: truncated, with its two digits after the dot apart. */
function percent(count: number, of: number): { whole: number; afterDot: number } {
  if (of <= 0) return { whole: 0, afterDot: 0 };
  const hundredths = Math.floor((count * 10_000) / of);
  return { whole: Math.floor(hundredths / 100), afterDot: hundredths % 100 };
}

/** The notes judged so far: every PERFECT … POOR (an empty POOR judges no note). */
function notesJudged(score: Pick<ScoreSummary, 'perfect' | 'great' | 'good' | 'bad' | 'poor'>): number {
  return score.perfect + score.great + score.good + score.bad + score.poor;
}

/**
 * LR2's score-rate numbers (OpenLR2 `SetObjectValue_Num`): the EX score as a percentage of the highest one over the
 * notes judged so far (102, with its digits after the dot on 103; LR2's running `rate`, 0 before the first note) and
 * over every note of the chart (115 / 116), each truncated as LR2 draws them. `undefined` for any other number.
 */
export function resolveLr2RateNumber(
  num: number,
  score: Pick<ScoreSummary, 'total' | 'perfect' | 'great' | 'good' | 'bad' | 'poor' | 'exScore'>,
): number | undefined {
  switch (num) {
    case LR2_NUM.SCORE_RATE:
      return percent(score.exScore, notesJudged(score) * 2).whole;
    case LR2_NUM.SCORE_RATE_AFTERDOT:
      return percent(score.exScore, notesJudged(score) * 2).afterDot;
    case LR2_NUM.TOTAL_RATE:
      return percent(score.exScore, score.total * 2).whole;
    case LR2_NUM.TOTAL_RATE_AFTERDOT:
      return percent(score.exScore, score.total * 2).afterDot;
    default:
      return undefined;
  }
}
