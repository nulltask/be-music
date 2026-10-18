import { describe, expect, test } from 'vite-plus/test';
import {
  computeScoreRate,
  createEmptyScore,
  IIDX_RANK_LABELS,
  resolveDisplayedPoor,
  resolveIidxRankIndexFromScore,
  resolveIidxRankLabel,
  resolveLr2MoneyScore,
} from './vocabulary.ts';

describe('the score vocabulary', () => {
  test('creates an empty score summary for a known total', () => {
    expect(createEmptyScore(120)).toEqual({
      total: 120,
      perfect: 0,
      great: 0,
      good: 0,
      bad: 0,
      poor: 0,
      emptyPoor: 0,
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
  });

  test('ranks a score on the IIDX ninths, best first', () => {
    // 8/9 of 200 is 177.8: 178 is AAA, 177 is AA.
    expect(resolveIidxRankIndexFromScore({ total: 100, exScore: 178 })).toBe(0);
    expect(resolveIidxRankIndexFromScore({ total: 100, exScore: 177 })).toBe(1);
    expect(resolveIidxRankIndexFromScore({ total: 100, exScore: 0 })).toBe(IIDX_RANK_LABELS.indexOf('F'));
    expect(resolveIidxRankIndexFromScore({ total: 0, exScore: 0 })).toBeUndefined();
  });

  test("LR2's money score is (4PG + 2GR + GD) x 50000 / notes, capped at 200000", () => {
    expect(resolveLr2MoneyScore({ total: 100, perfect: 100, great: 0, good: 0 })).toBe(200000);
    expect(resolveLr2MoneyScore({ total: 100, perfect: 99, great: 1, good: 0 })).toBe(
      Math.floor(((4 * 99 + 2) * 50000) / 100),
    );
    expect(resolveLr2MoneyScore({ total: 3, perfect: 0, great: 0, good: 1 })).toBe(16666);
  });

  test("resolveDisplayedPoor folds empty POORs in only where the ruleset's counter does", () => {
    const score = { poor: 3, emptyPoor: 2 };

    expect(resolveDisplayedPoor(score, true)).toBe(5); // LR2's counter shows the sum
    expect(resolveDisplayedPoor(score, false)).toBe(3);
  });
});
