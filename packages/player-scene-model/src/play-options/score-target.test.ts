import { expect, test } from 'vite-plus/test';
import {
  clampScoreTargetRate,
  DEFAULT_SCORE_TARGET_RATE,
  parseRankingScoreTarget,
  resolveRankingTargetIndex,
  resolveScoreTarget,
  SCORE_TARGET_IDS,
} from './score-target.ts';

test('offers beatoraja’s default targets but its rival ones, then SCORE RATE', () => {
  expect(SCORE_TARGET_IDS).toHaveLength(36);
  expect(SCORE_TARGET_IDS[0]).toBe('RATE_A-');
  expect(SCORE_TARGET_IDS[11]).toBe('RANK_NEXT');
  expect(SCORE_TARGET_IDS.slice(12, 35).every((id) => parseRankingScoreTarget(id) !== undefined)).toBe(true);
  expect(SCORE_TARGET_IDS.some((id) => id.startsWith('RIVAL'))).toBe(false);
  expect(SCORE_TARGET_IDS.at(-1)).toBe('SCORE_RATE');
});

test('resolves a rank border in twenty-sevenths of the maximum, rounded up', () => {
  // 1000 notes: max 2000.
  const of = (id: (typeof SCORE_TARGET_IDS)[number]) => resolveScoreTarget(id, { totalNotes: 1000 });
  expect(of('RATE_A')).toEqual({ label: 'RANK A', exScore: 1334 });
  expect(of('RATE_AA')).toEqual({ label: 'RANK AA', exScore: 1556 });
  expect(of('RATE_AAA')).toEqual({ label: 'RANK AAA', exScore: 1778 });
  expect(of('RATE_AAA+')).toEqual({ label: 'RANK AAA+', exScore: 1852 });
  expect(of('RATE_MAX-')).toEqual({ label: 'RANK MAX-', exScore: 1926 });
  expect(of('MAX')).toEqual({ label: 'MAX', exScore: 2000 });
});

test('never asks for more than the maximum, and has no target without notes', () => {
  for (const id of SCORE_TARGET_IDS) {
    for (const totalNotes of [1, 2, 3, 27, 54, 999]) {
      // A ranking target has a score once the ranking gives one; one above the maximum is held to it.
      const target = resolveScoreTarget(id, { totalNotes, rankingEXScore: totalNotes * 3 });
      expect(target!.exScore).toBeGreaterThan(0);
      expect(target!.exScore).toBeLessThanOrEqual(totalNotes * 2);
    }
    expect(resolveScoreTarget(id, { totalNotes: 0 })).toBeUndefined();
  }
});

test('NEXT RANK is the first border above the best score, from 15/27 up', () => {
  const next = (bestEXScore?: number) => resolveScoreTarget('RANK_NEXT', { totalNotes: 1000, bestEXScore })?.exScore;
  // No record: the lowest border, 15/27.
  expect(next()).toBe(1112);
  expect(next(1111)).toBe(1112);
  // A score on a border has reached it.
  expect(next(1112)).toBe(1186);
  expect(next(1800)).toBe(1852);
  // Past MAX-, the target is MAX.
  expect(next(1926)).toBe(2000);
  expect(next(2000)).toBe(2000);
});

test('SCORE RATE is that share of the maximum, rounded up as beatoraja’s RATE_<n> is', () => {
  const rate = (value?: number) => resolveScoreTarget('SCORE_RATE', { totalNotes: 1000, rate: value });
  expect(rate()).toEqual({ label: `SCORE RATE ${DEFAULT_SCORE_TARGET_RATE}%`, exScore: 1800 });
  expect(rate(85.5)).toEqual({ label: 'SCORE RATE 85.5%', exScore: 1710 });
  expect(rate(100)).toEqual({ label: 'SCORE RATE 100%', exScore: 2000 });
  expect(rate(0)?.exScore).toBe(0);
  // 333 notes at 50 %: 666 × 50 / 100 = 333.
  expect(resolveScoreTarget('SCORE_RATE', { totalNotes: 333, rate: 50 })?.exScore).toBe(333);
  expect(resolveScoreTarget('SCORE_RATE', { totalNotes: 7, rate: 33.3 })?.exScore).toBe(5);
});

test('clampScoreTargetRate keeps a rate from 0 to 100 on the 0.1 grid', () => {
  expect(clampScoreTargetRate(85.54)).toBe(85.5);
  expect(clampScoreTargetRate(-3)).toBe(0);
  expect(clampScoreTargetRate(140)).toBe(100);
  expect(clampScoreTargetRate(Number.NaN)).toBe(DEFAULT_SCORE_TARGET_RATE);
});

test('a ranking target is named as beatoraja names it and waits for the ranking’s score', () => {
  expect(parseRankingScoreTarget('IR_NEXT_3')).toEqual({ kind: 'NEXT', value: 3, label: 'IR NEXT 3RANK' });
  expect(parseRankingScoreTarget('IR_RANK_10')).toEqual({ kind: 'RANK', value: 10, label: 'IR RANK 10' });
  expect(parseRankingScoreTarget('IR_RANKRATE_25')).toEqual({ kind: 'RANKRATE', value: 25, label: 'IR RANK TOP 25%' });
  expect(parseRankingScoreTarget('RATE_AAA')).toBeUndefined();
  expect(parseRankingScoreTarget('SCORE_RATE')).toBeUndefined();
  expect(resolveScoreTarget('IR_RANK_1', { totalNotes: 1000 })).toBeUndefined();
  expect(resolveScoreTarget('IR_RANK_1', { totalNotes: 1000, rankingEXScore: 1987 })).toEqual({
    label: 'IR RANK 1',
    exScore: 1987,
  });
});

test('resolveRankingTargetIndex picks the place beatoraja’s getTargetRank picks', () => {
  const index = (id: (typeof SCORE_TARGET_IDS)[number], players: number, ownIndex?: number) =>
    resolveRankingTargetIndex(parseRankingScoreTarget(id)!, players, ownIndex);
  // RANK: the place, or the last one of a shorter ranking.
  expect(index('IR_RANK_1', 30)).toBe(0);
  expect(index('IR_RANK_10', 30)).toBe(9);
  expect(index('IR_RANK_50', 30)).toBe(29);
  // RANKRATE: players × n / 100, truncated.
  expect(index('IR_RANKRATE_10', 30)).toBe(3);
  expect(index('IR_RANKRATE_50', 1)).toBe(0);
  expect(index('IR_RANKRATE_5', 19)).toBe(0);
  // NEXT: n places above the first entry at or below the best; the top when there is none or it runs out.
  expect(index('IR_NEXT_1', 30, 10)).toBe(9);
  expect(index('IR_NEXT_5', 30, 3)).toBe(0);
  expect(index('IR_NEXT_1', 30)).toBe(0);
  expect(index('IR_RANK_1', 0)).toBeUndefined();
});
