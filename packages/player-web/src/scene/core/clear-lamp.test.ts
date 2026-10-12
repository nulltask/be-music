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
