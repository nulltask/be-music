import { describe, expect, test } from 'vitest';
import { applyJudgeToSummary, createScoreTracker, IIDX_SCORE_MAX, type ScoreSummary } from './scoring.ts';

function createSummary(total: number): ScoreSummary {
  return {
    total,
    perfect: 0,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
    exScore: 0,
    score: 0,
  };
}

describe('scoring', () => {
  test('reaches max score only for all PERFECT', () => {
    const summary = createSummary(100);
    const tracker = createScoreTracker();
    for (let index = 0; index < summary.total; index += 1) {
      applyJudgeToSummary(summary, 'PERFECT', tracker);
    }
    expect(summary.score).toBe(IIDX_SCORE_MAX);
  });

  test('drops score when at least one non-PERFECT exists', () => {
    const summary = createSummary(100);
    const tracker = createScoreTracker();
    for (let index = 0; index < summary.total - 1; index += 1) {
      applyJudgeToSummary(summary, 'PERFECT', tracker);
    }
    applyJudgeToSummary(summary, 'GREAT', tracker);
    expect(summary.score).toBeLessThan(IIDX_SCORE_MAX);
  });
});
