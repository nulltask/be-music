import { describe, expect, it } from 'vitest';
import {
  beatImpulse,
  clamp01,
  easeOutBack,
  easeOutCubic,
  easeOutExpo,
  impactOffset,
  slamOffset,
  slamScale,
  staggerProgress,
} from './motion.ts';

describe('clamp01', () => {
  it('saturates outside [0, 1] and treats non-finite values as 0', () => {
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(4)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('easing', () => {
  it('pins endpoints for the slam family', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
    expect(easeOutBack(0)).toBeCloseTo(0, 5);
    expect(easeOutBack(1)).toBeCloseTo(1, 5);
  });

  it('overshoots above 1 in the middle of easeOutBack', () => {
    expect(easeOutBack(0.7)).toBeGreaterThan(1);
  });
});

describe('slamScale', () => {
  it('starts at `from` and settles on 1', () => {
    expect(slamScale(0, 3)).toBeCloseTo(3, 5);
    expect(slamScale(1, 3)).toBeCloseTo(1, 5);
  });

  it('overshoots below 1 while landing from a large start', () => {
    expect(slamScale(0.7, 2.4)).toBeLessThan(1);
  });
});

describe('slamOffset', () => {
  it('throws in from the left and lands on 0', () => {
    expect(slamOffset(0, -40)).toBe(-40);
    expect(slamOffset(1, -40)).toBeCloseTo(0, 5);
  });
});

describe('impactOffset', () => {
  it('is full magnitude on impact and gone when settled', () => {
    expect(impactOffset(0, 8)).toBe(8);
    expect(impactOffset(1, 8)).toBeCloseTo(0, 5);
  });
});

describe('beatImpulse', () => {
  it('peaks on the downbeat and is silent past the decay window', () => {
    expect(beatImpulse(0, 0.25)).toBe(1);
    expect(beatImpulse(0.125, 0.25)).toBeCloseTo(0.5, 5);
    expect(beatImpulse(0.4, 0.25)).toBe(0);
    expect(beatImpulse(undefined)).toBe(0);
  });

  it('wraps a negative fractional phase the same way a looping beat would', () => {
    expect(beatImpulse(-0.01, 0.2)).toBeCloseTo(beatImpulse(0.99, 0.2), 5);
  });
});

describe('staggerProgress', () => {
  it('stays at 0 until the delay, then ramps to 1', () => {
    expect(staggerProgress(40, 80, 100)).toBe(0);
    expect(staggerProgress(130, 80, 100)).toBeCloseTo(0.5, 5);
    expect(staggerProgress(220, 80, 100)).toBe(1);
  });
});
