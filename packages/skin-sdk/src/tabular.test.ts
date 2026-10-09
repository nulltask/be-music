import { describe, expect, it } from 'vite-plus/test';
import { layoutTabularRun } from './tabular.ts';

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
