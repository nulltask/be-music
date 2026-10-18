import { describe, expect, it } from 'vite-plus/test';
import { judgeColorFor, resolveTimingVisualizerBands } from './timing-graphs.ts';

describe('judgeColorFor', () => {
  it('maps each judge kind to its tick colour', () => {
    expect(judgeColorFor('PERFECT')).toBe(0xffff00);
    expect(judgeColorFor('GREAT')).toBe(0x00ff00);
    expect(judgeColorFor('GOOD')).toBe(0x00aaff);
    expect(judgeColorFor('BAD')).toBe(0xff0000);
    expect(judgeColorFor('POOR')).toBe(0xff00ff);
  });

  it('paints an unknown kind white', () => {
    expect(judgeColorFor('')).toBe(0xffffff);
    expect(judgeColorFor('perfect')).toBe(0xffffff);
  });
});

describe('resolveTimingVisualizerBands', () => {
  const COLORS = { pg: 1, gr: 2, gd: 3, bd: 4, pr: 5 };
  const window = (earlyMs: number, lateMs: number) => ({ earlyMs, lateMs });
  const symmetric = (pg: number, gr: number, gd: number, bd: number) => ({
    perfect: window(pg, pg),
    great: window(gr, gr),
    good: window(gd, gd),
    bad: window(bd, bd),
  });

  it('stacks each judgment outward from the centre, then POOR to the edge', () => {
    // LR2 NORMAL at 1 px per ms on a visualizer 150 ms either side.
    const bands = resolveTimingVisualizerBands(symmetric(18, 40, 100, 120), COLORS, {
      centerX: 150,
      judgeWidthRate: 1,
      halfWidthMs: 150,
      transparentPr: false,
    });
    expect(bands).toEqual([
      { x: 132, width: 18, color: 1 },
      { x: 150, width: 18, color: 1 },
      { x: 110, width: 22, color: 2 },
      { x: 168, width: 22, color: 2 },
      { x: 50, width: 60, color: 3 },
      { x: 190, width: 60, color: 3 },
      { x: 30, width: 20, color: 4 },
      { x: 250, width: 20, color: 4 },
      { x: 0, width: 30, color: 5 },
      { x: 270, width: 30, color: 5 },
    ]);
  });

  it("reaches a window's early ms to the left and its late ms to the right, where late samples land", () => {
    // beatoraja 7 KEY NORMAL: BAD reaches 220 ms early and 280 ms late; at 0.5 px per ms.
    const bands = resolveTimingVisualizerBands(
      { perfect: window(20, 20), great: window(60, 60), good: window(150, 150), bad: window(220, 280) },
      COLORS,
      { centerX: 200, judgeWidthRate: 0.5, halfWidthMs: 300, transparentPr: true },
    );
    expect(bands.filter((band) => band.color === 4)).toEqual([
      { x: 90, width: 35, color: 4 },
      { x: 275, width: 65, color: 4 },
    ]);
    // `transparent = 1` paints no POOR band.
    expect(bands.some((band) => band.color === 5)).toBe(false);
  });

  it("clamps the windows to the visualizer's width, leaving a band nothing new to cover out", () => {
    const bands = resolveTimingVisualizerBands(symmetric(18, 40, 100, 200), COLORS, {
      centerX: 50,
      judgeWidthRate: 1,
      halfWidthMs: 150,
      transparentPr: false,
    });
    expect(bands.filter((band) => band.color === 3)).toEqual([
      { x: 0, width: 10, color: 3 },
      { x: 90, width: 10, color: 3 },
    ]);
    expect(bands.some((band) => band.color === 4 || band.color === 5)).toBe(false);
  });
});
