import { describe, expect, it } from 'vite-plus/test';
import { resolveCoverStripes } from './cover-pattern.ts';

function bounds(polygon: readonly number[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = polygon.filter((_, index) => index % 2 === 0);
  const ys = polygon.filter((_, index) => index % 2 === 1);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function area(polygon: readonly number[]): number {
  let twice = 0;
  const count = polygon.length / 2;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    twice += polygon[i * 2]! * polygon[j * 2 + 1]! - polygon[j * 2]! * polygon[i * 2 + 1]!;
  }
  return Math.abs(twice) / 2;
}

describe('resolveCoverStripes', () => {
  const rect = { x: 10, y: 20, w: 100, h: 50 };

  it('keeps every stripe inside the cover', () => {
    const stripes = resolveCoverStripes(rect, 70);
    expect(stripes.length).toBeGreaterThan(0);
    for (const stripe of stripes) {
      const box = bounds(stripe);
      expect(box.minX).toBeGreaterThanOrEqual(rect.x - 1e-9);
      expect(box.maxX).toBeLessThanOrEqual(rect.x + rect.w + 1e-9);
      expect(box.minY).toBeGreaterThanOrEqual(rect.y - 1e-9);
      expect(box.maxY).toBeLessThanOrEqual(rect.y + rect.h + 1e-9);
    }
  });

  it('covers width / spacing of the cover', () => {
    const covered = resolveCoverStripes(rect, 70, 12, 4).reduce((sum, stripe) => sum + area(stripe), 0);
    expect(covered / (rect.w * rect.h)).toBeCloseTo(4 / 12, 1);
  });

  it('moves the stripes with the anchor', () => {
    const at = resolveCoverStripes(rect, 70, 12, 4);
    const moved = resolveCoverStripes({ ...rect, y: rect.y + 12 }, 82, 12, 4);
    // A whole spacing down with the anchor: the same stripes, shifted down by 12.
    expect(moved.length).toBe(at.length);
    expect(moved[0]!.map((value, index) => (index % 2 === 1 ? value - 12 : value))).toEqual(
      at[0]!.map((value) => expect.closeTo(value, 9)),
    );
  });

  it('starts a stripe at the anchor corner', () => {
    const stripes = resolveCoverStripes({ x: 0, y: 0, w: 24, h: 24 }, 24, 12, 4);
    // u = x + (y - 24) is 0 at the bottom-left corner: a stripe starts there.
    expect(
      stripes.some((stripe) =>
        stripe.some((_, index) => index % 2 === 0 && stripe[index] === 0 && stripe[index + 1] === 24),
      ),
    ).toBe(true);
  });

  it('draws nothing on an empty cover', () => {
    expect(resolveCoverStripes({ x: 0, y: 0, w: 0, h: 10 }, 0)).toEqual([]);
    expect(resolveCoverStripes({ x: 0, y: 0, w: 10, h: 0 }, 0)).toEqual([]);
    expect(resolveCoverStripes({ x: 0, y: 0, w: 10, h: Number.NaN }, 0)).toEqual([]);
  });
});
