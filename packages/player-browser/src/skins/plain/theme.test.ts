import { describe, expect, it } from 'vite-plus/test';
import { marqueeOffset } from './theme.ts';

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
