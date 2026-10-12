import { describe, expect, it } from 'vite-plus/test';
import type { BeMusicRect } from '@be-music/skin-sdk';
import { resolveResultGrid } from './result-grid.ts';

const overlaps = (a: BeMusicRect, b: BeMusicRect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const panels = (width: number, height: number): BeMusicRect[] => {
  const grid = resolveResultGrid(width, height);
  return [grid.rank, ...grid.metrics, grid.judges, grid.graphs, grid.track];
};

describe('resolveResultGrid', () => {
  for (const [name, width, height] of [
    ['landscape', 854, 480],
    ['portrait', 480, 854],
  ] as const) {
    it(`keeps the ${name} panels apart and on the stage, above the total line`, () => {
      const grid = resolveResultGrid(width, height);
      const rects = panels(width, height);
      for (const [index, rect] of rects.entries()) {
        expect(rect.x).toBeGreaterThanOrEqual(grid.margin);
        expect(rect.x + rect.w).toBeLessThanOrEqual(width - grid.margin + 1e-9);
        expect(rect.y + rect.h).toBeLessThan(grid.totalY);
        for (const other of rects.slice(index + 1)) expect(overlaps(rect, other)).toBe(false);
      }
      // Five judgement rows fit their panel; the graphs' shared lines sit inside theirs.
      expect(grid.rowsTop + 4 * grid.rowPitch + 12).toBeLessThanOrEqual(grid.judges.y + grid.judges.h);
      expect(grid.graphsTop).toBeGreaterThan(grid.graphs.y);
      expect(grid.graphsBottom).toBeLessThan(grid.graphs.y + grid.graphs.h);
    });
  }

  it('stacks the portrait panels full width under the DJ LEVEL row', () => {
    const grid = resolveResultGrid(480, 854);
    expect(grid.judges.w).toBe(480 - 2 * grid.margin);
    expect(grid.graphs.y).toBeGreaterThan(grid.judges.y + grid.judges.h);
    expect(grid.track.y).toBeGreaterThan(grid.graphs.y + grid.graphs.h);
    expect(grid.trackColumns).toBe(2);
  });

  it('keeps the landscape grid of the 16:9 stage', () => {
    const grid = resolveResultGrid(854, 480);
    expect(grid.rank).toEqual({ x: 16, y: 64, w: 176, h: 152 });
    expect(grid.track.x).toBe(636);
    expect(grid.trackColumns).toBe(1);
  });
});
