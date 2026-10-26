import { expect, test } from 'vite-plus/test';
import {
  adjustBeatorajaJudgeTiming,
  createLR2JudgeTimingSamples,
  isLR2JudgeTimingAutoAdjust,
  JUDGE_TIMING_AUTO_ADJUST_MODES,
  resolveJudgeTimingAutoAdjust,
  sampleLR2JudgeTiming,
  settleLR2JudgeTiming,
} from './judge-timing.ts';

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

test('reads every mode, and the boolean replays recorded before the modes', () => {
  for (const mode of JUDGE_TIMING_AUTO_ADJUST_MODES) expect(resolveJudgeTimingAutoAdjust(mode)).toBe(mode);
  expect(resolveJudgeTimingAutoAdjust(true)).toBe('BEATORAJA');
  for (const value of [false, undefined, null, 'ON', 1]) expect(resolveJudgeTimingAutoAdjust(value)).toBe('OFF');
  expect(isLR2JudgeTimingAutoAdjust('LR2-ON')).toBe(true);
  expect(isLR2JudgeTimingAutoAdjust('LR2-SILENT')).toBe(true);
  expect(isLR2JudgeTimingAutoAdjust('BEATORAJA')).toBe(false);
  expect(isLR2JudgeTimingAutoAdjust(undefined)).toBe(false);
});

test('LR2 samples PGREAT to BAD hits of normal notes, in whole milliseconds', () => {
  const samples = createLR2JudgeTimingSamples();
  for (const judge of ['PERFECT', 'GREAT', 'GOOD', 'BAD'])
    expect(sampleLR2JudgeTiming(samples, judge, 3.4, false)).toBe(true);
  expect(samples).toEqual({ count: 4, sumMs: 12 });
  // A miss or an empty POOR, a long note, and a judgment without an offset are not sampled.
  expect(sampleLR2JudgeTiming(samples, 'POOR', 100, false)).toBe(false);
  expect(sampleLR2JudgeTiming(samples, 'PERFECT', 5, true)).toBe(false);
  expect(sampleLR2JudgeTiming(samples, 'BAD', -50, true)).toBe(false);
  expect(sampleLR2JudgeTiming(samples, 'GREAT', undefined, false)).toBe(false);
  expect(sampleLR2JudgeTiming(samples, 'GREAT', NaN, false)).toBe(false);
  expect(samples).toEqual({ count: 4, sumMs: 12 });
});

test('LR2 steps 1 ms by the sign of the sum once more than nine hits are sampled', () => {
  const late = createLR2JudgeTimingSamples();
  for (let index = 0; index < 9; index += 1) sampleLR2JudgeTiming(late, 'GOOD', 40, false);
  // Nine samples leave the timing and the window alone.
  expect(settleLR2JudgeTiming(98, late)).toBe(98);
  expect(late.count).toBe(9);
  sampleLR2JudgeTiming(late, 'PERFECT', -1, false);
  // The tenth steps it by 1 ms only, past LR2's ±99 select range, and empties the window.
  expect(settleLR2JudgeTiming(99, late)).toBe(100);
  expect(late).toEqual({ count: 0, sumMs: 0 });

  const early = { count: 25, sumMs: -1 };
  expect(settleLR2JudgeTiming(0, early)).toBe(-1);
  const balanced = { count: 10, sumMs: 0 };
  expect(settleLR2JudgeTiming(7, balanced)).toBe(7);
  expect(balanced).toEqual({ count: 0, sumMs: 0 });
});
