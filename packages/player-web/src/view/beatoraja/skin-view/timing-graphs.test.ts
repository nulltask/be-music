import { describe, expect, it } from 'vite-plus/test';
import { judgeColorFor } from './timing-graphs.ts';

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
