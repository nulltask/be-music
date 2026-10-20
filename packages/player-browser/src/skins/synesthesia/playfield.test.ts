import { describe, expect, it } from 'vite-plus/test';
import { mineFilamentLit } from './playfield.ts';

describe('mineFilamentLit', () => {
  it('lights about two segments in three', () => {
    let lit = 0;
    const total = 2000;
    for (let index = 0; index < total; index += 1) if (mineFilamentLit(120, index % 8, index * 37)) lit += 1;
    expect(lit / total).toBeGreaterThan(0.55);
    expect(lit / total).toBeLessThan(0.75);
  });

  it('holds steady within one flicker tick and re-rolls across ticks', () => {
    const pattern = (nowMs: number) => Array.from({ length: 16 }, (_, segment) => mineFilamentLit(200, segment, nowMs));
    expect(pattern(1000)).toEqual(pattern(1010));
    const later = Array.from({ length: 20 }, (_, tick) => pattern(1000 + tick * 100).join());
    expect(new Set(later).size).toBeGreaterThan(1);
  });
});
