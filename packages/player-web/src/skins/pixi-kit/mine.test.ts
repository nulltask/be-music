import { describe, expect, it } from 'vite-plus/test';
import { CAUTION_MINE_HEIGHT, cautionMineStripes, clipPolygonToSpan } from './mine.ts';

const xs = (points: readonly number[]): number[] => points.filter((_, index) => index % 2 === 0);

describe('clipPolygonToSpan', () => {
  it('keeps a polygon already inside the band', () => {
    const square = [2, 0, 4, 0, 4, 2, 2, 2];
    expect(clipPolygonToSpan(square, 0, 10)).toEqual(square);
  });

  it('cuts a polygon straddling both edges down to the band', () => {
    const clipped = clipPolygonToSpan([-5, 0, 15, 0, 15, 4, -5, 4], 0, 10);
    expect(Math.min(...xs(clipped))).toBe(0);
    expect(Math.max(...xs(clipped))).toBe(10);
  });

  it('interpolates the cut along slanted edges', () => {
    // A parallelogram leaning right: its bottom-left corner sits left of the band.
    const clipped = clipPolygonToSpan([-4, 10, 0, 10, 8, 0, 4, 0], 0, 100);
    expect(clipped).toContainEqual(0);
    const at0 = [];
    for (let index = 0; index < clipped.length; index += 2) if (clipped[index] === 0) at0.push(clipped[index + 1]);
    expect(at0).toContain(5);
  });

  it('returns nothing for a polygon outside the band', () => {
    expect(clipPolygonToSpan([20, 0, 30, 0, 30, 5], 0, 10)).toEqual([]);
  });
});

describe('cautionMineStripes', () => {
  it('keeps every stripe inside the mine body', () => {
    const x = 100;
    const w = 30;
    const y = 400;
    const stripes = cautionMineStripes(x, w, y);
    expect(stripes.length).toBeGreaterThan(2);
    for (const stripe of stripes) {
      for (const sx of xs(stripe)) {
        expect(sx).toBeGreaterThanOrEqual(x);
        expect(sx).toBeLessThanOrEqual(x + w);
      }
      for (let index = 1; index < stripe.length; index += 2) {
        expect(stripe[index]).toBeGreaterThanOrEqual(y - CAUTION_MINE_HEIGHT);
        expect(stripe[index]).toBeLessThanOrEqual(y);
      }
    }
  });
});
