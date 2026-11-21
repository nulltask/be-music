import { describe, expect, it, test } from 'vite-plus/test';
import { marqueeOffset, tabularText } from './theme.ts';

describe('marqueeOffset', () => {
  it('rests at the start, scrolls at 32 px/s, rests at the end, then starts over', () => {
    // 64 px of overflow: 1.5 s hold, 2 s scroll, 1 s hold — a 4.5 s cycle.
    expect(marqueeOffset(0, 64)).toBe(0);
    expect(marqueeOffset(1500, 64)).toBe(0);
    expect(marqueeOffset(2500, 64)).toBeCloseTo(32);
    expect(marqueeOffset(3500, 64)).toBeCloseTo(64);
    expect(marqueeOffset(4400, 64)).toBe(64);
    expect(marqueeOffset(4500 + 100, 64)).toBe(0);
  });

  it('never scrolls text that fits', () => {
    expect(marqueeOffset(2500, 0)).toBe(0);
    expect(marqueeOffset(2500, -10)).toBe(0);
  });
});

/** A context whose `0` is 8 wide, `1` 4 wide and other characters 6, recording each glyph drawn. */
function fakeContext(): CanvasRenderingContext2D & { drawn: [string, number][] } {
  const drawn: [string, number][] = [];
  return {
    drawn,
    font: '',
    fillStyle: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    measureText: (char: string) => ({ width: char === '0' ? 8 : char === '1' ? 4 : 6 }),
    fillText: (char: string, x: number) => drawn.push([char, x]),
  } as unknown as CanvasRenderingContext2D & { drawn: [string, number][] };
}

describe('tabularText', () => {
  test('gives every digit the widest digit’s cell, centred on x', () => {
    const ctx = fakeContext();
    tabularText(ctx, '-11ms', 100, 50, { size: 10, align: 'center' });
    // '-' 6, '1' 8, '1' 8, 'm' 6, 's' 6: 34 wide, from 83.
    expect(ctx.drawn).toEqual([
      ['-', 86],
      ['1', 93],
      ['1', 101],
      ['m', 108],
      ['s', 114],
    ]);
  });

  test('keeps a 1 and a 0 in the same place', () => {
    const one = fakeContext();
    const zero = fakeContext();
    tabularText(one, '+1ms', 0, 0, { size: 10 });
    tabularText(zero, '+0ms', 0, 0, { size: 10 });
    expect(one.drawn.map(([, x]) => x)).toEqual(zero.drawn.map(([, x]) => x));
  });
});
