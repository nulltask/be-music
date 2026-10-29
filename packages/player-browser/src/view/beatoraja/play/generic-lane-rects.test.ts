import { expect, test } from 'vite-plus/test';
import { createGenericLaneRects } from './generic-lane-rects.ts';

test.each([6, 8, 36, 70])(
  'fits %s equal generic keys inside the borrowed note area without scratch widths or a DP gap',
  (count) => {
    const original = [
      { x: 20, y: 40, w: 60, h: 600 },
      { x: 90, y: 40, w: 30, h: 600 },
    ];
    const rects = createGenericLaneRects(original, count);
    expect(rects).toHaveLength(count);
    expect(rects[0]).toMatchObject({ x: 20, y: 40, h: 600 });
    for (let index = 0; index < count; index++) {
      expect(rects[index]!.w).toBeCloseTo(100 / count);
      if (index > 0) expect(rects[index]!.x).toBeCloseTo(rects[index - 1]!.x + rects[index - 1]!.w);
    }
    expect(rects.at(-1)!.x + rects.at(-1)!.w).toBeCloseTo(120);
    expect(original[0]!.w).toBe(60);
  },
);
