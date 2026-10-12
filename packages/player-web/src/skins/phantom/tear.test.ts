import type { Graphics, Text } from 'pixi.js';
import { describe, expect, it } from 'vite-plus/test';
import { PHANTOM_INK, ransomLayout } from './style.ts';
import { addRansomText, stripPoint, tearOpenness, type GlyphFactory } from './tear.ts';

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

describe('addRansomText', () => {
  /** Records each glyph's fill; the nodes are just enough of a `Text` for the layout to place them. */
  function recordGlyphs(): { fills: number[]; glyph: GlyphFactory } {
    const fills: number[] = [];
    const glyph: GlyphFactory = (_char, options) => {
      fills.push(options.fill);
      const point = { set: () => undefined };
      return {
        width: options.size * 0.6,
        anchor: point,
        position: point,
        scale: { x: 1, y: 1, set: () => undefined },
      } as unknown as Text;
    };
    return { fills, glyph };
  }
  const graphics = { poly: () => ({ fill: () => undefined }) } as unknown as Graphics;

  it('recolours the letters on ink and red cards with the accent, keeping ink letters on paper cards', () => {
    const { fills, glyph } = recordGlyphs();
    addRansomText(graphics, glyph, 'GREAT', 0, 0, { size: 30, seed: 4, accent: 0x123456 });

    const papers = ransomLayout('GREAT', 4).map((entry) => entry.paper);
    expect(fills).toEqual(papers.map((paper) => (paper === 'paper' ? PHANTOM_INK : 0x123456)));
  });

  it('keeps the default letter colours without an accent', () => {
    const { fills, glyph } = recordGlyphs();
    addRansomText(graphics, glyph, 'GREAT', 0, 0, { size: 30, seed: 4 });

    expect(fills).not.toContain(0x123456);
  });
});
