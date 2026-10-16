import { describe, expect, test } from 'vite-plus/test';
import type { PlaylogRulesetResult } from '@be-music/player/playlog';
import { ClearLamp, resolveClearLamp, resolveMissCount, toCourseClearLamp } from './lamp.ts';

function result(
  gauge: { type: string; cleared: boolean },
  judge: Partial<PlaylogRulesetResult['judge']> = {},
): PlaylogRulesetResult {
  return {
    ruleset: 'lr2/0',
    judge: { pgreat: 10, great: 5, good: 2, bad: 1, poor: 1, emptyPoor: 3, ...judge },
    fast: 0,
    slow: 0,
    exScore: 25,
    noteCount: 19,
    maxCombo: 10,
    gauge: { ...gauge, final: 80 },
  };
}

describe('resolveClearLamp', () => {
  test('a run that did not clear is FAILED whatever its judgments', () => {
    expect(resolveClearLamp(result({ type: 'HARD', cleared: false }, { bad: 0, poor: 0 }), 'lr2')).toBe(
      ClearLamp.FAILED,
    );
  });

  test.each([
    ['ASSIST-EASY', 'beatoraja', ClearLamp.ASSIST_EASY],
    ['ASSISTED-EASY', 'iidx', ClearLamp.ASSIST_EASY],
    ['EASY', 'lr2', ClearLamp.EASY],
    ['GROOVE', 'lr2', ClearLamp.NORMAL],
    ['NORMAL', 'beatoraja', ClearLamp.NORMAL],
    ['HARD', 'iidx', ClearLamp.HARD],
    ['EX-HARD', 'beatoraja', ClearLamp.EX_HARD],
    ['DEATH', 'lr2', ClearLamp.NORMAL],
    ['DEATH', 'beatoraja', ClearLamp.EX_HARD],
    ['HAZARD', 'beatoraja', ClearLamp.EX_HARD],
    ['SOMETHING-NEW', 'lr2', ClearLamp.NORMAL],
  ] as const)('a cleared %s gauge under %s gives lamp %i', (type, ruleset, lamp) => {
    expect(resolveClearLamp(result({ type, cleared: true }), ruleset)).toBe(lamp);
  });

  test('no BAD and no missed POOR is a FULL COMBO, empty POORs notwithstanding', () => {
    expect(resolveClearLamp(result({ type: 'EASY', cleared: true }, { bad: 0, poor: 0, emptyPoor: 9 }), 'lr2')).toBe(
      ClearLamp.FULL_COMBO,
    );
  });

  test('a chart without notes takes its gauge’s lamp, not a full combo', () => {
    const empty = { ...result({ type: 'HARD', cleared: true }, { pgreat: 0, great: 0, good: 0, bad: 0, poor: 0 }) };
    expect(resolveClearLamp({ ...empty, noteCount: 0 }, 'beatoraja')).toBe(ClearLamp.HARD);
    expect(resolveClearLamp({ ...empty, noteCount: 0 }, 'lr2')).toBe(ClearLamp.HARD);
  });

  test('beatoraja awards PERFECT and MAX; LR2 and IIDX stop at FULL COMBO', () => {
    const perfect = result({ type: 'NORMAL', cleared: true }, { bad: 0, poor: 0, good: 0 });
    const max = result({ type: 'NORMAL', cleared: true }, { bad: 0, poor: 0, good: 0, great: 0 });
    expect(resolveClearLamp(perfect, 'beatoraja')).toBe(ClearLamp.PERFECT);
    expect(resolveClearLamp(max, 'beatoraja')).toBe(ClearLamp.MAX);
    expect(resolveClearLamp(max, 'lr2')).toBe(ClearLamp.FULL_COMBO);
    expect(resolveClearLamp(max, 'iidx')).toBe(ClearLamp.FULL_COMBO);
  });
});

describe('resolveMissCount', () => {
  test('counts BADs, missed POORs and empty POORs, LR2 included', () => {
    // LR2 adds an empty POOR to its POOR count, so its BP includes them like beatoraja's.
    expect(resolveMissCount(result({ type: 'GROOVE', cleared: true }, { bad: 2, poor: 3, emptyPoor: 4 }))).toBe(9);
  });
});

describe('toCourseClearLamp', () => {
  test('puts course lamps on the chart lamp scale', () => {
    expect(toCourseClearLamp('FAILED')).toBe(ClearLamp.FAILED);
    expect(toCourseClearLamp('EASY')).toBe(ClearLamp.EASY);
    expect(toCourseClearLamp('NORMAL')).toBe(ClearLamp.NORMAL);
    expect(toCourseClearLamp('EX_HARD')).toBe(ClearLamp.EX_HARD);
    expect(toCourseClearLamp('MAX')).toBe(ClearLamp.MAX);
  });
});

describe('LR2 gauge lamps', () => {
  test('a DEATH clear is NORMAL under LR2 and EX HARD elsewhere', () => {
    const death = result({ type: 'DEATH', cleared: true }, { bad: 1 });
    expect(resolveClearLamp(death, 'lr2')).toBe(ClearLamp.NORMAL);
    expect(resolveClearLamp(death, 'beatoraja')).toBe(ClearLamp.EX_HARD);
    expect(resolveClearLamp(result({ type: 'HARD', cleared: true }, { bad: 1 }), 'lr2')).toBe(ClearLamp.HARD);
  });
});
