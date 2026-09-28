import { describe, expect, it } from 'vite-plus/test';
import { stripPoint, tearOpenness } from './tear.ts';

describe('tearOpenness', () => {
  it('is shut before and after the cut-in', () => {
    expect(tearOpenness(0)).toBe(0);
    expect(tearOpenness(1)).toBe(0);
    expect(tearOpenness(-0.5)).toBe(0);
  });

  it('rips open with an overshoot, holds, then snaps shut', () => {
    let peak = 0;
    for (let step = 1; step <= 12; step += 1) peak = Math.max(peak, tearOpenness(step / 100));
    expect(peak).toBeGreaterThan(1);
    expect(tearOpenness(0.5)).toBeCloseTo(1, 9);
    expect(tearOpenness(0.95)).toBeLessThan(0.3);
  });
});

describe('stripPoint', () => {
  it('maps along / across the strip axis', () => {
    const strip = { cx: 100, cy: 50, angle: Math.PI / 2, length: 200, thickness: 40, seed: 1 };
    const point = stripPoint(strip, 10, 5);
    expect(point.x).toBeCloseTo(95, 9);
    expect(point.y).toBeCloseTo(60, 9);
  });
});
