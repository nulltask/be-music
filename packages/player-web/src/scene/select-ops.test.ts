import { describe, expect, it } from 'vite-plus/test';
import { DEFAULT_PLAY_OPTIONS } from './core/select.ts';
import { computeSelectOps, resolveLr2BarLampKind, resolveLr2LampOp, SELECT_DYNAMIC_OPS } from './select-ops.ts';

describe('resolveLr2BarLampKind', () => {
  it('folds the host lamps onto LR2’s six', () => {
    expect(resolveLr2BarLampKind(undefined)).toBe('noplay');
    expect(resolveLr2BarLampKind('NO_PLAY')).toBe('noplay');
    expect(resolveLr2BarLampKind('FAILED')).toBe('failed');
    expect(resolveLr2BarLampKind('ASSIST_EASY')).toBe('easy');
    expect(resolveLr2BarLampKind('EASY')).toBe('easy');
    expect(resolveLr2BarLampKind('NORMAL')).toBe('clear');
    expect(resolveLr2BarLampKind('HARD')).toBe('hard');
    expect(resolveLr2BarLampKind('EX_HARD')).toBe('hard');
    expect(resolveLr2BarLampKind('FULL_COMBO')).toBe('fullcombo');
    expect(resolveLr2BarLampKind('MAX')).toBe('fullcombo');
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

describe('computeSelectOps', () => {
  it('lights NO PLAY without a focused bar', () => {
    const ops = computeSelectOps(undefined, new Set(), DEFAULT_PLAY_OPTIONS);
    expect(ops.has(SELECT_DYNAMIC_OPS.LAMP_NOT_PLAYED)).toBe(true);
  });
});
