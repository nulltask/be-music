import type { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vite-plus/test';
import { drawReticle, grainsFor, ShapeBatch, trailGrainsFor } from './draw.ts';

/** Records the geometry and paint calls a `Graphics` receives, in order. */
function recorder(): { graphics: Graphics; calls: string[] } {
  const calls: string[] = [];
  const graphics = {
    rect(x: number, y: number, w: number, h: number) {
      calls.push(`rect ${x},${y},${w},${h}`);
      return graphics;
    },
    moveTo(x: number, y: number) {
      calls.push(`move ${x},${y}`);
      return graphics;
    },
    lineTo(x: number, y: number) {
      calls.push(`line ${x},${y}`);
      return graphics;
    },
    fill(style: { color: number; alpha: number }) {
      calls.push(`fill ${style.color.toString(16)} ${style.alpha}`);
      return graphics;
    },
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number) {
      calls.push(`quad ${cpx},${cpy} ${x},${y}`);
      return graphics;
    },
    stroke(style: { color: number; width: number; alpha: number }) {
      calls.push(`stroke ${style.color.toString(16)} ${style.width} ${style.alpha}`);
      return graphics;
    },
  } as unknown as Graphics;
  return { graphics, calls };
}

describe('ShapeBatch', () => {
  it('merges rects of one quantized colour and alpha into a single fill', () => {
    const { graphics, calls } = recorder();
    const batch = new ShapeBatch();
    batch.rect(graphics, 0xff6612, 0.5, 0, 0, 1, 1);
    batch.rect(graphics, 0xff6a1e, 0.52, 2, 2, 1, 1);
    batch.flush();
    expect(calls).toEqual(['rect 0,0,1,1', 'rect 2,2,1,1', 'fill f86818 0.5']);
  });

  it('keeps different colours, alphas, and targets in separate buckets', () => {
    const a = recorder();
    const b = recorder();
    const batch = new ShapeBatch();
    batch.rect(a.graphics, 0x00ff00, 1, 0, 0, 1, 1);
    batch.rect(a.graphics, 0x0000ff, 1, 1, 0, 1, 1);
    batch.rect(a.graphics, 0x00ff00, 0.25, 2, 0, 1, 1);
    batch.rect(b.graphics, 0x00ff00, 1, 3, 0, 1, 1);
    batch.flush();
    expect(a.calls.filter((call) => call.startsWith('fill'))).toHaveLength(3);
    expect(b.calls).toEqual(['rect 3,0,1,1', 'fill 8f808 1']);
  });

  it('strokes lines per width bucket and skips invisible shapes', () => {
    const { graphics, calls } = recorder();
    const batch = new ShapeBatch();
    batch.line(graphics, 0xffffff, 1, 1, 0, 0, 5, 5);
    batch.line(graphics, 0xffffff, 1, 2, 0, 1, 5, 6);
    batch.rect(graphics, 0xffffff, 0.01, 0, 0, 1, 1);
    batch.flush();
    expect(calls).toEqual(['move 0,0', 'line 5,5', 'stroke f8f8f8 1 1', 'move 0,1', 'line 5,6', 'stroke f8f8f8 2 1']);
  });

  it('strokes streaks as solid lines even when segments break into grains', () => {
    const { graphics, calls } = recorder();
    const batch = new ShapeBatch(true);
    batch.streak(graphics, 0xffffff, 1, 1, 0, 0, 40, 30);
    batch.streak(graphics, 0xffffff, 0.01, 1, 0, 0, 40, 30);
    batch.flush();
    expect(calls).toEqual(['move 0,0', 'line 40,30', 'stroke f8f8f8 1 1']);
  });

  it('starts every flush empty and routes buckets to the graphics given that frame', () => {
    const first = recorder();
    const second = recorder();
    const batch = new ShapeBatch();
    batch.rect(first.graphics, 0xff0000, 1, 0, 0, 1, 1);
    batch.flush();
    batch.rect(second.graphics, 0xff0000, 1, 9, 9, 1, 1);
    batch.flush();
    expect(first.calls).toEqual(['rect 0,0,1,1', 'fill f80808 1']);
    expect(second.calls).toEqual(['rect 9,9,1,1', 'fill f80808 1']);
  });
});

describe('grainsFor', () => {
  it('keeps a small point as one finer grain carrying the same light', () => {
    const grains = grainsFor(1, 0.4);
    expect(grains.count).toBe(1);
    expect(grains.size).toBeLessThan(1);
    expect(grains.count * grains.size ** 2 * grains.alpha).toBeCloseTo(0.8 * 1 * 0.4, 6);
  });

  it('breaks a larger point into several grains no bigger than about a pixel', () => {
    const grains = grainsFor(4, 0.2);
    expect(grains.count).toBeGreaterThan(1);
    expect(grains.count).toBeLessThanOrEqual(5);
    expect(grains.size).toBeLessThanOrEqual(1.1);
    expect(grains.size).toBeGreaterThanOrEqual(0.6);
  });

  it('never asks for more than full opacity', () => {
    expect(grainsFor(3, 1).alpha).toBeLessThanOrEqual(1);
    expect(grainsFor(0.5, 1).alpha).toBeLessThanOrEqual(1);
  });
});

describe('trailGrainsFor', () => {
  it('spaces grains about a pixel and a half apart along the segment', () => {
    expect(trailGrainsFor(16, 1, 0.5).count).toBe(11);
    expect(trailGrainsFor(0, 1, 0.5).count).toBe(1);
  });

  it('caps very long trails and keeps grains about a pixel across', () => {
    const grains = trailGrainsFor(400, 3, 0.5);
    expect(grains.count).toBe(32);
    expect(grains.size).toBeLessThanOrEqual(1.1);
    expect(grains.alpha).toBeLessThanOrEqual(1);
  });

  it('carries about the light the stroke did', () => {
    const grains = trailGrainsFor(10, 1, 0.3);
    expect(grains.lanes).toBe(1);
    expect(grains.count * grains.size ** 2 * grains.alpha).toBeCloseTo(0.8 * 10 * 1 * 0.3, 6);
  });

  it('spreads a wide stroke over parallel lanes without adding light', () => {
    const thin = trailGrainsFor(10, 1.4, 0.2);
    const wide = trailGrainsFor(10, 4.5, 0.2);
    expect(wide.lanes).toBe(3);
    expect(wide.lanes).toBeGreaterThan(thin.lanes);
    expect(wide.count * wide.lanes * wide.size ** 2 * wide.alpha).toBeCloseTo(0.8 * 10 * 4.5 * 0.2, 6);
  });
});

describe('drawReticle cross', () => {
  /** The cross's two arms as `[x1, y1, x2, y2]`, read from the last stroke's move/line pairs. */
  function crossArms(crossAngle?: number): number[][] {
    const { graphics, calls } = recorder();
    drawReticle(graphics, 0, 0, 100, 100, 0xffffff, 1, { cross: true, crossAngle });
    const cross = calls.slice(calls.lastIndexOf(calls.find((call) => call.startsWith('stroke'))!) + 1, -1);
    const points = cross.map((call) => call.split(' ')[1]!.split(',').map(Number));
    return [
      [...points[0]!, ...points[1]!],
      [...points[2]!, ...points[3]!],
    ];
  }

  it('draws an upright + about the centre by default', () => {
    expect(crossArms()).toEqual([
      [40, 50, 60, 50],
      [50, 40, 50, 60],
    ]);
  });

  it('turns counter-clockwise on screen for a negative angle', () => {
    const [horizontal] = crossArms(-Math.PI / 8);
    // y points down: the arm's right end rises and its left end drops.
    expect(horizontal![2]).toBeGreaterThan(50);
    expect(horizontal![3]).toBeLessThan(50);
    expect(horizontal![1]).toBeGreaterThan(50);
  });

  it('keeps both arms the same length and perpendicular at any angle', () => {
    const [a, b] = crossArms(-0.7);
    const va = [a![2]! - a![0]!, a![3]! - a![1]!];
    const vb = [b![2]! - b![0]!, b![3]! - b![1]!];
    expect(Math.hypot(va[0]!, va[1]!)).toBeCloseTo(20);
    expect(Math.hypot(vb[0]!, vb[1]!)).toBeCloseTo(20);
    expect(va[0]! * vb[0]! + va[1]! * vb[1]!).toBeCloseTo(0);
  });
});
