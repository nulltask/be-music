import { describe, expect, it } from 'vite-plus/test';
import { resolveLR2BarLamp, resolveLR2LampOp } from './records.ts';

describe('resolveLR2BarLamp', () => {
  it('folds be-music’s lamps onto LR2’s six', () => {
    expect(resolveLR2BarLamp(undefined)).toBe('noplay');
    expect(resolveLR2BarLamp('NO_PLAY')).toBe('noplay');
    expect(resolveLR2BarLamp('FAILED')).toBe('failed');
    expect(resolveLR2BarLamp('ASSIST_EASY')).toBe('easy');
    expect(resolveLR2BarLamp('EASY')).toBe('easy');
    expect(resolveLR2BarLamp('NORMAL')).toBe('clear');
    expect(resolveLR2BarLamp('HARD')).toBe('hard');
    expect(resolveLR2BarLamp('EX_HARD')).toBe('hard');
    expect(resolveLR2BarLamp('FULL_COMBO')).toBe('fullcombo');
    expect(resolveLR2BarLamp('MAX')).toBe('fullcombo');
  });
});

describe('resolveLR2LampOp', () => {
  it('lights ops 100-105 by the lamp', () => {
    expect(resolveLR2LampOp(undefined)).toBe(100);
    expect(resolveLR2LampOp('FAILED')).toBe(101);
    expect(resolveLR2LampOp('EASY')).toBe(102);
    expect(resolveLR2LampOp('NORMAL')).toBe(103);
    expect(resolveLR2LampOp('EX_HARD')).toBe(104);
    expect(resolveLR2LampOp('PERFECT')).toBe(105);
  });
});
