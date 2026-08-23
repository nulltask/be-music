import { describe, expect, it } from 'vitest';
import { resultRankSlam } from './result-render.ts';
import { beginDefaultSelectMotion } from './select-render.ts';

describe('resultRankSlam', () => {
  it('stays hidden until the rank timer has elapsed', () => {
    expect(resultRankSlam(0).visible).toBe(false);
    expect(resultRankSlam(-1).visible).toBe(false);
  });

  it('starts oversized and lands near 1', () => {
    const start = resultRankSlam(1);
    expect(start.visible).toBe(true);
    expect(start.scale).toBeGreaterThan(2);
    expect(resultRankSlam(420).scale).toBeCloseTo(1, 5);
    expect(resultRankSlam(420).offsetX).toBeCloseTo(0, 5);
  });
});

describe('beginDefaultSelectMotion', () => {
  it('resets on a fresh scene and slams when the cursor moves', () => {
    const intro = beginDefaultSelectMotion(0, 10);
    expect(intro.selectedSlamT).toBe(1);
    const moved = beginDefaultSelectMotion(3, 400);
    expect(moved.selectedSlamT).toBe(0);
    const later = beginDefaultSelectMotion(3, 620);
    expect(later.selectedSlamT).toBe(1);
  });
});
