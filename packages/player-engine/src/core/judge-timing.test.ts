import { expect, test } from 'vite-plus/test';
import { adjustBeatorajaJudgeTiming } from './judge-timing.ts';

test('ports upstream microsecond rounding, early/late signs and inclusive eligibility', () => {
  for (const judge of ['PERFECT', 'GREAT', 'GOOD']) {
    for (const [delta, adjustment] of [
      [0, 0],
      [14.999, 0],
      [15, 1],
      [44.999, 1],
      [45, 2],
      [150, 5],
      [150.001, 0],
    ]) {
      expect(adjustBeatorajaJudgeTiming(20, judge, delta)).toBe(20 + adjustment);
      expect(adjustBeatorajaJudgeTiming(20, judge, -delta)).toBe(20 - adjustment);
    }
  }
});

test('ignores misses, mines, bad hits, automated hits and invalid samples', () => {
  for (const judge of ['BAD', 'POOR', 'READY']) expect(adjustBeatorajaJudgeTiming(7, judge, 100)).toBe(7);
  for (const delta of [undefined, NaN, Infinity]) expect(adjustBeatorajaJudgeTiming(7, 'PERFECT', delta)).toBe(7);
});

test('does not apply the launcher clamp to automatic updates', () => {
  expect(adjustBeatorajaJudgeTiming(500, 'GOOD', 150)).toBe(505);
  expect(adjustBeatorajaJudgeTiming(-500, 'GOOD', -150)).toBe(-505);
});
