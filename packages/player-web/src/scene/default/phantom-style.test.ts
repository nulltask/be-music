import { describe, expect, it } from 'vite-plus/test';
import {
  easeOutBack,
  easeOutCubic,
  halftoneField,
  hash01,
  layoutTabularRun,
  parallelogramPoints,
  ransomLayout,
  rollUpValue,
  stageProgress,
  starburstPoints,
  tornBandPoints,
  tornEdgePoints,
} from './phantom-style.ts';

describe('parallelogramPoints', () => {
  it('shifts the top edge right for a positive slant', () => {
    expect(parallelogramPoints(10, 20, 100, 30, 8)).toEqual([18, 20, 118, 20, 110, 50, 10, 50]);
  });

  it('shifts the bottom edge right for a negative slant so the box never starts left of x', () => {
    expect(parallelogramPoints(10, 20, 100, 30, -8)).toEqual([10, 20, 110, 20, 118, 50, 18, 50]);
  });

  it('degrades to a rectangle with zero slant', () => {
    expect(parallelogramPoints(0, 0, 4, 2, 0)).toEqual([0, 0, 4, 0, 4, 2, 0, 2]);
  });
});

describe('starburstPoints', () => {
  it('alternates outer and inner radii around the centre', () => {
    const points = starburstPoints(0, 0, 10, 5, 4);
    expect(points).toHaveLength(16);
    const radii = [];
    for (let index = 0; index < points.length; index += 2) {
      radii.push(Math.round(Math.hypot(points[index]!, points[index + 1]!) * 1000) / 1000);
    }
    expect(radii).toEqual([10, 5, 10, 5, 10, 5, 10, 5]);
  });

  it('clamps the spike count to at least three', () => {
    expect(starburstPoints(0, 0, 10, 5, 1)).toHaveLength(12);
  });

  it('roughens only the outer tips and stays deterministic for a seed', () => {
    const first = starburstPoints(50, 50, 20, 8, 6, 0, 0.4, 7);
    const second = starburstPoints(50, 50, 20, 8, 6, 0, 0.4, 7);
    expect(first).toEqual(second);
    for (let index = 0; index < first.length; index += 2) {
      const radius = Math.hypot(first[index]! - 50, first[index + 1]! - 50);
      if ((index / 2) % 2 === 0) {
        expect(radius).toBeGreaterThanOrEqual(20 * 0.6 - 1e-9);
        expect(radius).toBeLessThanOrEqual(20 + 1e-9);
      } else {
        expect(radius).toBeCloseTo(8, 9);
      }
    }
  });
});

describe('halftoneField', () => {
  it('ramps dot radius along the direction and drops the invisible end', () => {
    const dots = halftoneField({ x: 0, y: 0, w: 40, h: 0.5, pitch: 10, maxRadius: 4, direction: { x: 1, y: 0 } });
    expect(dots.map((dot) => [dot.x, dot.r])).toEqual([
      [10, 1],
      [20, 2],
      [30, 3],
      [40, 4],
    ]);
  });

  it('staggers odd rows by half a pitch', () => {
    const dots = halftoneField({ x: 0, y: 0, w: 20, h: 10, pitch: 10, maxRadius: 2, direction: { x: 0, y: 1 } });
    expect(dots.filter((dot) => dot.y === 10).map((dot) => dot.x)).toEqual([5, 15]);
  });

  it('returns nothing for a degenerate field', () => {
    expect(halftoneField({ x: 0, y: 0, w: 0, h: 10, pitch: 4, maxRadius: 2, direction: { x: 1, y: 0 } })).toEqual([]);
    expect(halftoneField({ x: 0, y: 0, w: 10, h: 10, pitch: 0, maxRadius: 2, direction: { x: 1, y: 0 } })).toEqual([]);
  });
});

describe('hash01', () => {
  it('is deterministic and stays in [0, 1)', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const value = hash01(seed);
      expect(value).toBe(hash01(seed));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('layoutTabularRun', () => {
  // A proportional face where "1" is narrow and "0" is wide.
  const widths: Record<string, number> = { '0': 10, '1': 4, '2': 9, '/': 5, '%': 12 };
  const measure = (char: string) => widths[char] ?? 8;

  it('gives every digit the widest digit advance', () => {
    const { glyphs, width } = layoutTabularRun('101', measure);
    expect(glyphs.map((glyph) => [glyph.char, glyph.x, glyph.w])).toEqual([
      ['1', 0, 10],
      ['0', 10, 10],
      ['1', 20, 10],
    ]);
    expect(width).toBe(30);
  });

  it('keeps the natural advance for non-digits', () => {
    const { glyphs, width } = layoutTabularRun('1/2%', measure);
    expect(glyphs.map((glyph) => glyph.w)).toEqual([10, 5, 10, 12]);
    expect(glyphs.map((glyph) => glyph.x)).toEqual([0, 10, 15, 25]);
    expect(width).toBe(37);
  });

  it('makes equal-length numbers equally wide regardless of digits', () => {
    expect(layoutTabularRun('111', measure).width).toBe(layoutTabularRun('000', measure).width);
  });
});

describe('stageProgress', () => {
  it('stays at 0 before the delay, ramps, and clamps at 1', () => {
    expect(stageProgress(50, 100, 200)).toBe(0);
    expect(stageProgress(200, 100, 200)).toBe(0.5);
    expect(stageProgress(900, 100, 200)).toBe(1);
  });

  it('treats a zero duration as an instant step at the delay', () => {
    expect(stageProgress(99, 100, 0)).toBe(0);
    expect(stageProgress(100, 100, 0)).toBe(1);
  });
});

describe('easing', () => {
  it('pins both curves to 0 and 1 at the ends', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutBack(0)).toBeCloseTo(0, 12);
    expect(easeOutBack(1)).toBe(1);
  });

  it('lets easeOutBack overshoot past 1 mid-flight', () => {
    expect(Math.max(...[0.6, 0.7, 0.8, 0.9].map((t) => easeOutBack(t)))).toBeGreaterThan(1);
  });

  it('clamps inputs outside 0..1', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe('rollUpValue', () => {
  it('counts from 0 to the target', () => {
    expect(rollUpValue(1234, 0)).toBe(0);
    expect(rollUpValue(1234, 1)).toBe(1234);
    expect(rollUpValue(100, 0.5)).toBe(88);
  });

  it('returns 0 for a non-finite target', () => {
    expect(rollUpValue(Number.NaN, 1)).toBe(0);
  });
});

describe('tornEdgePoints', () => {
  it('starts and ends exactly on the line', () => {
    const points = tornEdgePoints(0, 0, 200, 0, 6, 3);
    expect(points.slice(0, 2)).toEqual([0, 0]);
    expect(points.slice(-2)).toEqual([200, 0]);
  });

  it('keeps every tooth within the shard bound of the line', () => {
    const points = tornEdgePoints(0, 50, 400, 50, 8, 7);
    for (let index = 1; index < points.length; index += 2) {
      expect(Math.abs(points[index]! - 50)).toBeLessThanOrEqual(8 * 2.5 + 1e-9);
    }
  });

  it('is jagged, deterministic, and seed-dependent', () => {
    const points = tornEdgePoints(0, 0, 300, 0, 6, 1);
    const offsets = new Set(points.filter((_, index) => index % 2 === 1).map((y) => Math.round(y * 10)));
    expect(offsets.size).toBeGreaterThan(5);
    expect(tornEdgePoints(0, 0, 300, 0, 6, 1)).toEqual(points);
    expect(tornEdgePoints(0, 0, 300, 0, 6, 2)).not.toEqual(points);
  });
});

describe('tornBandPoints', () => {
  it('wraps a strip of the given thickness around the line', () => {
    const band = tornBandPoints(0, 100, 400, 100, 40, 5, 4);
    const ys = band.filter((_, index) => index % 2 === 1);
    expect(Math.min(...ys)).toBeLessThan(80);
    expect(Math.max(...ys)).toBeGreaterThan(120);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(80 - 5 * 2.5 - 1e-9);
    expect(Math.max(...ys)).toBeLessThanOrEqual(120 + 5 * 2.5 + 1e-9);
  });
});

describe('ransomLayout', () => {
  it('cuts every letter differently within its ranges', () => {
    const glyphs = ransomLayout('SHOW TIME', 4);
    expect(glyphs).toHaveLength(9);
    expect(glyphs[4]!.space).toBe(true);
    for (const glyph of glyphs.filter((entry) => !entry.space)) {
      expect(glyph.font).toBeGreaterThanOrEqual(0);
      expect(glyph.font).toBeLessThan(4);
      expect(glyph.scale).toBeGreaterThanOrEqual(0.82);
      expect(glyph.scale).toBeLessThanOrEqual(1.2);
      expect(Math.abs(glyph.rotation)).toBeLessThanOrEqual(0.14);
      expect(Math.abs(glyph.dy)).toBeLessThanOrEqual(0.12);
    }
  });

  it('never gives neighbouring letters the same card', () => {
    const glyphs = ransomLayout('TAKEYOURHEART', 9);
    for (let index = 1; index < glyphs.length; index += 1) {
      expect(glyphs[index]!.paper).not.toBe(glyphs[index - 1]!.paper);
    }
  });

  it('is deterministic for a seed', () => {
    expect(ransomLayout('GO', 1)).toEqual(ransomLayout('GO', 1));
  });
});
