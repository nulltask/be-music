import { expect, test } from 'vite-plus/test';
import { resolveScoreTarget, SCORE_TARGET_IDS } from './score-target.ts';

test('offers beatoraja’s default targets and NEXT RANK', () => {
  expect(SCORE_TARGET_IDS).toHaveLength(12);
  expect(SCORE_TARGET_IDS[0]).toBe('RATE_A-');
  expect(SCORE_TARGET_IDS.at(-1)).toBe('RANK_NEXT');
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
      const target = resolveScoreTarget(id, { totalNotes });
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
