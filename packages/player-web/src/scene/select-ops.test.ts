import { LR2_OP } from '@be-music/lr2-skin/ids';
import { describe, expect, it } from 'vite-plus/test';
import { DEFAULT_PLAY_OPTIONS } from './core/select.ts';
import { computeSelectOps, courseMatchesKeysFilter, resolveLr2BarLampKind, resolveLr2LampOp } from './select-ops.ts';

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
    expect(ops.has(LR2_OP.LAMP_NO_PLAY)).toBe(true);
  });
});

describe('courseMatchesKeysFilter', () => {
  it('lists a course under its own key mode only, as LR2 lists courses by line', () => {
    const seven = { definition: { keyMode: 7 } };
    expect(courseMatchesKeysFilter(seven, LR2_OP.KEYS_7)).toBe(true);
    expect(courseMatchesKeysFilter(seven, LR2_OP.KEYS_14)).toBe(false);
    expect(courseMatchesKeysFilter({ definition: { keyMode: 9 } }, LR2_OP.KEYS_9)).toBe(true);
  });

  it('keeps a course that names no key mode and a NEW COURSE bar', () => {
    expect(courseMatchesKeysFilter({ definition: {} }, LR2_OP.KEYS_5)).toBe(true);
    expect(courseMatchesKeysFilter({ definition: { keyMode: 7 }, newCourse: true }, LR2_OP.KEYS_5)).toBe(true);
  });
});
