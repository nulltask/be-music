import { describe, expect, it } from 'vite-plus/test';
import {
  DEFAULT_MARQUEE_TIMING,
  MIN_TEXT_SQUEEZE,
  marqueeCycleMs,
  resolveMarqueeAlpha,
  resolveMarqueeOffset,
  resolveTextSqueeze,
  type MarqueeTiming,
} from './marquee.ts';

const timing: MarqueeTiming = { startHoldMs: 1000, speedPxPerSecond: 50, endHoldMs: 500, fadeMs: 200 };

describe('resolveTextSqueeze', () => {
  it('leaves text that fits at full width', () => {
    expect(resolveTextSqueeze(80, 100)).toBe(1);
    expect(resolveTextSqueeze(100, 100)).toBe(1);
  });

  it('squeezes text that fits within the minimum squeeze', () => {
    expect(resolveTextSqueeze(110, 100)).toBeCloseTo(100 / 110);
    expect(resolveTextSqueeze(100 / MIN_TEXT_SQUEEZE, 100)).toBeCloseTo(MIN_TEXT_SQUEEZE);
  });

  it('stops at the minimum squeeze for text that still overflows', () => {
    expect(resolveTextSqueeze(400, 100)).toBe(MIN_TEXT_SQUEEZE);
    expect(resolveTextSqueeze(400, 100, 0.5)).toBe(0.5);
  });

  it('treats empty or degenerate widths as fitting', () => {
    expect(resolveTextSqueeze(0, 100)).toBe(1);
    expect(resolveTextSqueeze(Number.NaN, 100)).toBe(1);
    expect(resolveTextSqueeze(50, 0)).toBe(MIN_TEXT_SQUEEZE);
  });
});

describe('marqueeCycleMs', () => {
  it('adds the holds to the scroll time', () => {
    // 100 px at 50 px/s scrolls for 2 s.
    expect(marqueeCycleMs(100, timing)).toBe(1000 + 2000 + 500);
  });

  it('is zero without overflow', () => {
    expect(marqueeCycleMs(0, timing)).toBe(0);
    expect(marqueeCycleMs(-5, timing)).toBe(0);
  });
});

describe('resolveMarqueeOffset', () => {
  it('holds at the start, scrolls at a constant speed, then holds at the end', () => {
    expect(resolveMarqueeOffset(0, 100, timing)).toBe(0);
    expect(resolveMarqueeOffset(999, 100, timing)).toBe(0);
    expect(resolveMarqueeOffset(1500, 100, timing)).toBeCloseTo(25);
    expect(resolveMarqueeOffset(2000, 100, timing)).toBeCloseTo(50);
    expect(resolveMarqueeOffset(3000, 100, timing)).toBeCloseTo(100);
    expect(resolveMarqueeOffset(3400, 100, timing)).toBe(100);
  });

  it('starts over after each cycle', () => {
    expect(resolveMarqueeOffset(3500 + 500, 100, timing)).toBe(0);
    expect(resolveMarqueeOffset(3500 * 2 + 1500, 100, timing)).toBeCloseTo(25);
  });

  it('never scrolls text that fits or before it appears', () => {
    expect(resolveMarqueeOffset(2000, 0, timing)).toBe(0);
    expect(resolveMarqueeOffset(-100, 100, timing)).toBe(0);
  });

  it('uses the default timing when none is given', () => {
    const { startHoldMs, speedPxPerSecond } = DEFAULT_MARQUEE_TIMING;
    expect(resolveMarqueeOffset(startHoldMs + 1000, 500)).toBeCloseTo(speedPxPerSecond);
  });
});

describe('resolveMarqueeAlpha', () => {
  it('shows the first appearance without a fade in', () => {
    expect(resolveMarqueeAlpha(0, 100, timing)).toBe(1);
    expect(resolveMarqueeAlpha(50, 100, timing)).toBe(1);
  });

  it('fades out at the end of the end hold and back in on the next cycle', () => {
    expect(resolveMarqueeAlpha(3200, 100, timing)).toBe(1);
    expect(resolveMarqueeAlpha(3400, 100, timing)).toBeCloseTo(0.5);
    expect(resolveMarqueeAlpha(3500 + 100, 100, timing)).toBeCloseTo(0.5);
    expect(resolveMarqueeAlpha(3500 + 200, 100, timing)).toBe(1);
  });

  it('stays opaque for text that fits or without a fade', () => {
    expect(resolveMarqueeAlpha(3400, 0, timing)).toBe(1);
    expect(resolveMarqueeAlpha(3400, 100, { ...timing, fadeMs: 0 })).toBe(1);
  });
});
