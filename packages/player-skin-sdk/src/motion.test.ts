import { describe, expect, it } from 'vite-plus/test';
import { easeOutBack, easeOutCubic, hash01, rollUpValue, stageProgress } from './motion.ts';

describe('hash01', () => {
  it('is deterministic and stays in [0, 1)', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const value = hash01(seed);
      expect(value).toBe(hash01(seed));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('stageProgress', () => {
  it('stays at 0 before the delay, ramps, and clamps at 1', () => {
    expect(stageProgress(50, 100, 200)).toBe(0);
    expect(stageProgress(200, 100, 200)).toBe(0.5);
    expect(stageProgress(900, 100, 200)).toBe(1);
  });

  it('treats a zero duration as an instant step at the delay', () => {
    expect(stageProgress(99, 100, 0)).toBe(0);
    expect(stageProgress(100, 100, 0)).toBe(1);
  });
});

describe('easing', () => {
  it('pins both curves to 0 and 1 at the ends', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutBack(0)).toBeCloseTo(0, 12);
    expect(easeOutBack(1)).toBe(1);
  });

  it('lets easeOutBack overshoot past 1 mid-flight', () => {
    expect(Math.max(...[0.6, 0.7, 0.8, 0.9].map((t) => easeOutBack(t)))).toBeGreaterThan(1);
  });

  it('clamps inputs outside 0..1', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe('rollUpValue', () => {
  it('counts from 0 to the target', () => {
    expect(rollUpValue(1234, 0)).toBe(0);
    expect(rollUpValue(1234, 1)).toBe(1234);
    expect(rollUpValue(100, 0.5)).toBe(88);
  });

  it('returns 0 for a non-finite target', () => {
    expect(rollUpValue(Number.NaN, 1)).toBe(0);
  });
});
