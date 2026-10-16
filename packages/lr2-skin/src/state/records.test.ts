import { describe, expect, it } from 'vite-plus/test';
import { resolveLr2BarLamp, resolveLr2LampOp } from './records.ts';

describe('resolveLr2BarLamp', () => {
  it('folds be-music’s lamps onto LR2’s six', () => {
    expect(resolveLr2BarLamp(undefined)).toBe('noplay');
    expect(resolveLr2BarLamp('NO_PLAY')).toBe('noplay');
    expect(resolveLr2BarLamp('FAILED')).toBe('failed');
    expect(resolveLr2BarLamp('ASSIST_EASY')).toBe('easy');
    expect(resolveLr2BarLamp('EASY')).toBe('easy');
    expect(resolveLr2BarLamp('NORMAL')).toBe('clear');
    expect(resolveLr2BarLamp('HARD')).toBe('hard');
    expect(resolveLr2BarLamp('EX_HARD')).toBe('hard');
    expect(resolveLr2BarLamp('FULL_COMBO')).toBe('fullcombo');
    expect(resolveLr2BarLamp('MAX')).toBe('fullcombo');
  });
});

describe('resolveLr2LampOp', () => {
  it('lights ops 100-105 by the lamp', () => {
    expect(resolveLr2LampOp(undefined)).toBe(100);
    expect(resolveLr2LampOp('FAILED')).toBe(101);
    expect(resolveLr2LampOp('EASY')).toBe(102);
    expect(resolveLr2LampOp('NORMAL')).toBe(103);
    expect(resolveLr2LampOp('EX_HARD')).toBe(104);
    expect(resolveLr2LampOp('PERFECT')).toBe(105);
  });
});
