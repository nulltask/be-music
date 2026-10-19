import { describe, expect, it } from 'vite-plus/test';
import {
  beatorajaTimingOffsetMs,
  judgeColorFor,
  resolveTimingDistributionBin,
  resolveTimingVisualizerBands,
  resolveTimingVisualizerSampleX,
} from './timing-graphs.ts';

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

  it("reaches a window's late ms to the left and its early ms to the right, as beatoraja draws them", () => {
    // beatoraja 7 KEY NORMAL: BAD reaches 220 ms early and 280 ms late; at 0.5 px per ms. Upstream's `judgeArea`
    // is {-280, 220} (note minus press time), its lower bound drawn left of the centre.
    const bands = resolveTimingVisualizerBands(
      { perfect: window(20, 20), great: window(60, 60), good: window(150, 150), bad: window(220, 280) },
      COLORS,
      { centerX: 200, judgeWidthRate: 0.5, halfWidthMs: 300, transparentPr: true },
    );
    expect(bands.filter((band) => band.color === 4)).toEqual([
      { x: 60, width: 65, color: 4 },
      { x: 275, width: 35, color: 4 },
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

describe('beatorajaTimingOffsetMs', () => {
  it("turns be-music's offset (> 0 late) into beatoraja's (note minus press time, > 0 early)", () => {
    expect(beatorajaTimingOffsetMs(12)).toBe(-12);
    expect(beatorajaTimingOffsetMs(-30.5)).toBe(30.5);
    expect(beatorajaTimingOffsetMs(0)).toBe(0);
    expect(beatorajaTimingOffsetMs(-0)).toBe(0);
  });
});

describe('resolveTimingVisualizerSampleX', () => {
  // The reference theme's defaults: 301 px for ±150 ms, so 1 px per ms; a 1 px line in a 301 px region.
  const LAYOUT = { centerLineLeft: 150, judgeWidthRate: 1, halfWidthMs: 150 };

  it('draws an early judgment right of the centre and a late one left, as beatoraja does', () => {
    expect(resolveTimingVisualizerSampleX(0, LAYOUT)).toBe(150);
    expect(resolveTimingVisualizerSampleX(-20, LAYOUT)).toBe(170);
    expect(resolveTimingVisualizerSampleX(35, LAYOUT)).toBe(115);
  });

  it("lands on the side of the band of the judgment's window", () => {
    // BAD 220 ms early / 280 ms late at 0.5 px per ms: an early BAD inside the right band, a late one inside the left.
    const bands = resolveTimingVisualizerBands(
      {
        perfect: { earlyMs: 20, lateMs: 20 },
        great: { earlyMs: 60, lateMs: 60 },
        good: { earlyMs: 150, lateMs: 150 },
        bad: { earlyMs: 220, lateMs: 280 },
      },
      { pg: 1, gr: 2, gd: 3, bd: 4, pr: 5 },
      { centerX: 200, judgeWidthRate: 0.5, halfWidthMs: 300, transparentPr: true },
    );
    const layout = { centerLineLeft: 200, judgeWidthRate: 0.5, halfWidthMs: 300 };
    const bandAt = (x: number) => bands.find((band) => band.x <= x && x < band.x + band.width)?.color;
    expect(bandAt(resolveTimingVisualizerSampleX(-200, layout))).toBe(4);
    expect(bandAt(resolveTimingVisualizerSampleX(260, layout))).toBe(4);
    expect(resolveTimingVisualizerSampleX(-200, layout)).toBeGreaterThan(200);
    expect(resolveTimingVisualizerSampleX(260, layout)).toBeLessThan(200);
  });

  it('clamps a judgment beyond the edge to the edge', () => {
    expect(resolveTimingVisualizerSampleX(-400, LAYOUT)).toBe(300);
    expect(resolveTimingVisualizerSampleX(400, LAYOUT)).toBe(0);
  });

  it('scales by the rate around the centre line', () => {
    expect(resolveTimingVisualizerSampleX(-10, { centerLineLeft: 99.5, judgeWidthRate: 2, halfWidthMs: 50 })).toBe(
      119.5,
    );
  });
});

describe('resolveTimingDistributionBin', () => {
  it('bins an early judgment right of the centre bin and a late one left, as beatoraja does', () => {
    expect(resolveTimingDistributionBin(0, 50)).toBe(50);
    expect(resolveTimingDistributionBin(-8, 50)).toBe(58);
    expect(resolveTimingDistributionBin(12, 50)).toBe(38);
  });

  it('rounds to the nearest ms', () => {
    expect(resolveTimingDistributionBin(-8.4, 50)).toBe(58);
    expect(resolveTimingDistributionBin(3.6, 50)).toBe(46);
  });

  it('keeps both edges and drops a judgment beyond them', () => {
    expect(resolveTimingDistributionBin(-50, 50)).toBe(100);
    expect(resolveTimingDistributionBin(50, 50)).toBe(0);
    expect(resolveTimingDistributionBin(-51, 50)).toBeUndefined();
    expect(resolveTimingDistributionBin(51, 50)).toBeUndefined();
  });
});
