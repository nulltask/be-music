import { describe, expect, it } from 'vite-plus/test';
import { resolveClearLamp } from './clear-lamp.ts';

const score = (perfect: number, great: number, good: number, total = 100) => ({ total, perfect, great, good });

describe('resolveClearLamp', () => {
  it('reports a failed gauge as FAILED, whatever the judgements', () => {
    expect(resolveClearLamp({ cleared: false, score: score(100, 0, 0), gaugeType: 'HARD' })).toBe('FAILED');
  });

  it('grades full combos by their worst judgement', () => {
    expect(resolveClearLamp({ cleared: true, score: score(100, 0, 0) })).toBe('MAX');
    expect(resolveClearLamp({ cleared: true, score: score(90, 10, 0) })).toBe('PERFECT');
    expect(resolveClearLamp({ cleared: true, score: score(80, 15, 5), gaugeType: 'EASY' })).toBe('FULL_COMBO');
  });

  it('takes the gauge lamp for a clear with misses', () => {
    const cases: [string, string][] = [
      ['GROOVE', 'NORMAL'],
      ['NORMAL', 'NORMAL'],
      ['EASY', 'EASY'],
      ['ASSIST-EASY', 'ASSIST_EASY'],
      ['ASSISTED-EASY', 'ASSIST_EASY'],
      ['HARD', 'HARD'],
      ['EX-HARD', 'EX_HARD'],
      ['DEATH', 'EX_HARD'],
      ['HAZARD', 'EX_HARD'],
      ['hard', 'HARD'],
      ['CLASS', 'NORMAL'],
    ];
    for (const [gaugeType, lamp] of cases) {
      expect(resolveClearLamp({ cleared: true, score: score(80, 10, 5), gaugeType })).toBe(lamp);
    }
    expect(resolveClearLamp({ cleared: true, score: score(80, 10, 5) })).toBe('NORMAL');
  });

  it('does not call an empty chart a full combo', () => {
    expect(resolveClearLamp({ cleared: true, score: score(0, 0, 0, 0), gaugeType: 'HARD' })).toBe('HARD');
  });
});

describe('resolveClearLamp under a ruleset', () => {
  it('LR2 and IIDX stop at FULL COMBO, beatoraja keeps PERFECT and MAX', () => {
    const max = score(100, 0, 0);
    expect(resolveClearLamp({ cleared: true, score: max, ruleset: 'lr2' })).toBe('FULL_COMBO');
    expect(resolveClearLamp({ cleared: true, score: max, ruleset: 'iidx' })).toBe('FULL_COMBO');
    expect(resolveClearLamp({ cleared: true, score: max, ruleset: 'beatoraja' })).toBe('MAX');
    expect(resolveClearLamp({ cleared: true, score: max })).toBe('MAX');
  });

  it('a DEATH clear is NORMAL under LR2 only', () => {
    const missed = score(90, 0, 0);
    expect(resolveClearLamp({ cleared: true, score: missed, gaugeType: 'DEATH', ruleset: 'lr2' })).toBe('NORMAL');
    expect(resolveClearLamp({ cleared: true, score: missed, gaugeType: 'DEATH', ruleset: 'beatoraja' })).toBe(
      'EX_HARD',
    );
    expect(resolveClearLamp({ cleared: true, score: missed, gaugeType: 'HARD', ruleset: 'lr2' })).toBe('HARD');
  });
});
