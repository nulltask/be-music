import { expect, test } from 'vite-plus/test';
import { clampJudgeTimingMs, resolveNoteDisplaySeconds } from './judge-timing.ts';

test('uses the beatoraja PlayerConfig integer millisecond range', () => {
  expect(clampJudgeTimingMs(0)).toBe(0);
  expect(clampJudgeTimingMs(1000)).toBe(500);
  expect(clampJudgeTimingMs(-1000)).toBe(-500);
  expect(clampJudgeTimingMs(1.4)).toBe(1);
  expect(clampJudgeTimingMs(NaN)).toBe(0);
});

test('positive timing advances only the display clock, including before chart zero', () => {
  expect(resolveNoteDisplaySeconds(1, 125)).toBe(1.125);
  expect(resolveNoteDisplaySeconds(1, -125)).toBe(0.875);
  expect(resolveNoteDisplaySeconds(0, -125)).toBe(-0.125);
  expect(resolveNoteDisplaySeconds(1, 0)).toBe(1);
});
