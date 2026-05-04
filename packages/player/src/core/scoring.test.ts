import { describe, expect, test } from 'vitest';
import {
  applyJudgeToSummary,
  computeScoreRate,
  createEmptyScore,
  createScoreTracker,
  IIDX_SCORE_MAX,
  resolveIidxRankLabel,
  resolveIidxSelectRankOp,
  type ScoreSummary,
} from './scoring.ts';

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
  test('creates an empty score summary for a known total', () => {
    expect(createEmptyScore(120)).toEqual({
      total: 120,
      perfect: 0,
      great: 0,
      good: 0,
      bad: 0,
      poor: 0,
      exScore: 0,
      score: 0,
    });
  });

  test('resolves IIDX score rate and rank labels', () => {
    expect(computeScoreRate({ total: 100, exScore: 200 })).toBe(1);
    expect(computeScoreRate({ total: 100, exScore: 300 })).toBe(1);
    expect(computeScoreRate({ total: 0, exScore: 0 })).toBe(0);
    expect(resolveIidxRankLabel(178, 100)).toBe('AAA');
    expect(resolveIidxRankLabel(10, 100)).toBe('F');
    expect(resolveIidxRankLabel(0, 0)).toBe('-');
    expect(resolveIidxSelectRankOp({ total: 100, exScore: 178 })).toBe(200);
    expect(resolveIidxSelectRankOp({ total: 0, exScore: 0 })).toBeUndefined();
  });

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
