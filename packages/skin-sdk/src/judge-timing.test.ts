import { describe, expect, it } from 'vite-plus/test';
import { binJudgeTimings } from './judge-timing.ts';

const timings = (...deltas: number[]) => deltas.map((deltaMs) => ({ deltaMs }));

describe('binJudgeTimings', () => {
  it('has no bins without timings or a range', () => {
    expect(binJudgeTimings([])).toEqual({ binMs: 1, originMs: 0, counts: [] });
  });

  it('bins 1 ms wide from the earliest to the latest timing by default', () => {
    expect(binJudgeTimings(timings(-2, 0, 0, 1))).toEqual({ binMs: 1, originMs: -2, counts: [1, 0, 2, 1] });
  });

  it('puts bin edges on multiples of binMs, early timings below zero', () => {
    // Bins: [-10, -5) [-5, 0) [0, 5) [5, 10)
    expect(binJudgeTimings(timings(-7, -5, -0.5, 0, 4.9, 5, 9), 5)).toEqual({
      binMs: 5,
      originMs: -10,
      counts: [1, 2, 2, 2],
    });
  });

  it('reports a 0 origin for timings that are all late', () => {
    expect(Object.is(binJudgeTimings(timings(0.5, 3), 2).originMs, 0)).toBe(true);
  });

  it('covers -rangeMs..rangeMs when given and leaves timings outside out', () => {
    expect(binJudgeTimings(timings(-30, -10, 0, 10, 30), 10, 20)).toEqual({
      binMs: 10,
      originMs: -20,
      counts: [0, 1, 1, 1, 0],
    });
    expect(binJudgeTimings([], 10, 20).counts).toEqual([0, 0, 0, 0, 0]);
  });

  it('skips timings that are not finite', () => {
    expect(binJudgeTimings(timings(Number.NaN, 1, Number.POSITIVE_INFINITY))).toEqual({
      binMs: 1,
      originMs: 1,
      counts: [1],
    });
  });

  it('refuses a bin width that is not positive', () => {
    expect(() => binJudgeTimings(timings(1), 0)).toThrow(RangeError);
    expect(() => binJudgeTimings(timings(1), Number.NaN)).toThrow(RangeError);
  });
});
