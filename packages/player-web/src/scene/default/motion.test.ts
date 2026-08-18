import { describe, expect, it } from 'vitest';
import {
  beatPulse,
  clamp01,
  countUp,
  cursorFollow,
  easeOutBack,
  easeOutCubic,
  introFill,
  judgePopup,
  shardFlight,
  slideOffset,
  staggerProgress,
  valuePunch,
} from './motion.ts';

describe('clamp01 / easing', () => {
  it('clamps non-finite and out-of-range values', () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.25)).toBe(0.25);
  });

  it('easeOutCubic starts at 0, ends at 1, and is front-loaded', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it('easeOutBack overshoots then settles', () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 5);
    expect(easeOutBack(1)).toBeCloseTo(1, 5);
    expect(easeOutBack(0.7)).toBeGreaterThan(1);
  });
});

describe('staggerProgress / slideOffset', () => {
  it('stays at 0 through the delay, then fills the duration', () => {
    expect(staggerProgress(40, 80, 200)).toBe(0);
    expect(staggerProgress(180, 80, 200)).toBeCloseTo(0.5, 5);
    expect(staggerProgress(300, 80, 200)).toBe(1);
  });

  it('treats a zero duration as already complete', () => {
    expect(staggerProgress(0, 0, 0)).toBe(1);
  });

  it('slides from fromPx to 0', () => {
    expect(slideOffset(0, 24)).toBe(24);
    expect(slideOffset(1, 24)).toBe(0);
    expect(slideOffset(0.5, 24)).toBe(12);
  });
});

describe('cursorFollow', () => {
  it('moves toward the target without overshooting a step', () => {
    const next = cursorFollow(0, 28, 16);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(28);
  });

  it('reaches the target given enough time', () => {
    let y = 0;
    for (let i = 0; i < 40; i += 1) y = cursorFollow(y, 28, 16);
    expect(y).toBeCloseTo(28, 2);
  });
});

describe('judgePopup', () => {
  it('pops in large, then settles near scale 1 before fading', () => {
    const start = judgePopup(16);
    expect(start.scale).toBeGreaterThan(1.2);
    expect(start.alpha).toBeGreaterThan(0);
    const hold = judgePopup(180);
    expect(hold.scale).toBeCloseTo(1, 1);
    expect(hold.alpha).toBe(1);
    const end = judgePopup(400);
    expect(end.alpha).toBeLessThan(0.3);
    expect(judgePopup(500).alpha).toBe(0);
  });
});

describe('valuePunch / introFill / countUp', () => {
  it('punches above 1 then returns to 1', () => {
    expect(valuePunch(0)).toBeCloseTo(1.18, 5);
    expect(valuePunch(200)).toBe(1);
    expect(valuePunch(40)).toBeGreaterThan(1);
  });

  it('fills the gauge from empty during intro', () => {
    expect(introFill(0.8, 0)).toBe(0);
    expect(introFill(0.8, 1)).toBeCloseTo(0.8, 5);
  });

  it('counts up to the target', () => {
    expect(countUp(1000, 0, 500)).toBe(0);
    expect(countUp(1000, 500, 500)).toBe(1000);
    expect(countUp(1000, 100, 500)).toBeGreaterThan(0);
    expect(countUp(1000, 100, 500)).toBeLessThan(1000);
  });
});

describe('beatPulse / shardFlight', () => {
  it('peaks on the downbeat', () => {
    expect(beatPulse(0, 0.4)).toBe(1);
    expect(beatPulse(0.99, 0.4)).toBeCloseTo(0.6, 2);
    expect(beatPulse(undefined, 0.4)).toBe(1);
  });

  it('sends shards outward while fading', () => {
    const early = shardFlight(0, 200, 0, 8);
    const late = shardFlight(180, 200, 0, 8);
    expect(Math.hypot(late.x, late.y)).toBeGreaterThan(Math.hypot(early.x, early.y));
    expect(late.alpha).toBeLessThan(early.alpha);
  });
});
