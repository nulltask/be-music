import { describe, expect, it } from 'vite-plus/test';
import {
  betterClearLamp,
  CLEAR_LAMPS,
  clearLampAtRank,
  clearLampRank,
  isClearLamp,
  isFullCombo,
  resolveClearLamp,
  resolveCourseClearLamp,
  resolveMissCount,
  topClearLamp,
  type CourseClearLampFacts,
} from './clear-lamp.ts';

const score = (perfect: number, great: number, good: number, total = 100) => ({ total, perfect, great, good });

describe('clear lamp ranks', () => {
  it('ranks lamps from NO_PLAY up to MAX, as the Leaderboard stores them', () => {
    expect(CLEAR_LAMPS.map(clearLampRank)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(clearLampRank('FAILED')).toBe(1);
    expect(clearLampRank('MAX')).toBe(9);
    expect(clearLampRank('SUPER' as never)).toBe(0);
  });

  it('reads a rank back as its lamp', () => {
    expect(CLEAR_LAMPS.every((lamp) => clearLampAtRank(clearLampRank(lamp)) === lamp)).toBe(true);
    expect(clearLampAtRank(10)).toBeUndefined();
    expect(clearLampAtRank(-1)).toBeUndefined();
    expect(clearLampAtRank(1.5)).toBeUndefined();
  });

  it('knows the lamp names', () => {
    expect(isClearLamp('EX_HARD')).toBe(true);
    expect(isClearLamp('EX-HARD')).toBe(false);
    expect(isClearLamp(7)).toBe(false);
  });

  it('keeps the better lamp, the current one on a tie', () => {
    expect(betterClearLamp('HARD', 'EASY')).toBe('HARD');
    expect(betterClearLamp('HARD', 'FULL_COMBO')).toBe('FULL_COMBO');
    expect(betterClearLamp('NO_PLAY', 'FAILED')).toBe('FAILED');
  });

  it('tops LR2 and IIDX at FULL COMBO, beatoraja and unknown rulesets at MAX', () => {
    expect(topClearLamp('lr2')).toBe('FULL_COMBO');
    expect(topClearLamp('iidx')).toBe('FULL_COMBO');
    expect(topClearLamp('beatoraja')).toBe('MAX');
    expect(topClearLamp(undefined)).toBe('MAX');
  });
});

describe('isFullCombo', () => {
  it('needs every note judged GOOD or better', () => {
    expect(isFullCombo(score(80, 15, 5))).toBe(true);
    expect(isFullCombo(score(80, 15, 4))).toBe(false);
  });

  it('does not call an empty chart a full combo', () => {
    expect(isFullCombo(score(0, 0, 0, 0))).toBe(false);
  });
});

describe('resolveClearLamp', () => {
  it('reports a failed gauge as FAILED, whatever the judgements', () => {
    expect(resolveClearLamp({ cleared: false, score: score(100, 0, 0), gauge: 'HARD' })).toBe('FAILED');
  });

  it('grades full combos by their worst judgement', () => {
    expect(resolveClearLamp({ cleared: true, score: score(100, 0, 0) })).toBe('MAX');
    expect(resolveClearLamp({ cleared: true, score: score(90, 10, 0) })).toBe('PERFECT');
    expect(resolveClearLamp({ cleared: true, score: score(80, 15, 5), gauge: 'EASY' })).toBe('FULL_COMBO');
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
      ['SOMETHING-NEW', 'NORMAL'],
    ];
    for (const [gauge, lamp] of cases) {
      expect(resolveClearLamp({ cleared: true, score: score(80, 10, 5), gauge })).toBe(lamp);
    }
    expect(resolveClearLamp({ cleared: true, score: score(80, 10, 5) })).toBe('NORMAL');
  });

  it('does not call an empty chart a full combo', () => {
    expect(resolveClearLamp({ cleared: true, score: score(0, 0, 0, 0), gauge: 'HARD' })).toBe('HARD');
  });

  it('does not call a play that stopped before its last note a full combo', () => {
    expect(resolveClearLamp({ cleared: true, score: score(60, 0, 0), gauge: 'HARD' })).toBe('HARD');
  });
});

describe('resolveClearLamp under a ruleset', () => {
  it('LR2 and IIDX stop at FULL COMBO, beatoraja keeps PERFECT and MAX', () => {
    const max = score(100, 0, 0);
    expect(resolveClearLamp({ cleared: true, score: max, ruleset: 'lr2' })).toBe('FULL_COMBO');
    expect(resolveClearLamp({ cleared: true, score: max, ruleset: 'iidx' })).toBe('FULL_COMBO');
    expect(resolveClearLamp({ cleared: true, score: max, ruleset: 'beatoraja' })).toBe('MAX');
    expect(resolveClearLamp({ cleared: true, score: score(90, 10, 0), ruleset: 'beatoraja' })).toBe('PERFECT');
    expect(resolveClearLamp({ cleared: true, score: max })).toBe('MAX');
  });

  it('a DEATH clear is NORMAL under LR2 only', () => {
    const missed = score(90, 0, 0);
    expect(resolveClearLamp({ cleared: true, score: missed, gauge: 'DEATH', ruleset: 'lr2' })).toBe('NORMAL');
    expect(resolveClearLamp({ cleared: true, score: missed, gauge: 'DEATH', ruleset: 'beatoraja' })).toBe('EX_HARD');
    expect(resolveClearLamp({ cleared: true, score: missed, gauge: 'HAZARD', ruleset: 'beatoraja' })).toBe('EX_HARD');
    expect(resolveClearLamp({ cleared: true, score: missed, gauge: 'HARD', ruleset: 'lr2' })).toBe('HARD');
  });
});

describe('resolveCourseClearLamp', () => {
  const run = (overrides: Partial<CourseClearLampFacts> = {}): CourseClearLampFacts => ({
    ruleset: 'lr2',
    cleared: true,
    gauge: 'GRADE',
    gaugeType: 'GROOVE',
    noteCount: 100,
    maxCombo: 40,
    judge: { great: 10, good: 5 },
    ...overrides,
  });

  it('is FAILED when the run did not clear', () => {
    expect(resolveCourseClearLamp(run({ cleared: false, maxCombo: 100 }))).toBe('FAILED');
  });

  it('follows the gauge pick under LR2: EASY, HARD, and NORMAL for GROOVE and DEATH', () => {
    expect(resolveCourseClearLamp(run({ gaugeType: 'EASY' }))).toBe('EASY');
    expect(resolveCourseClearLamp(run({ gaugeType: 'HARD', gauge: 'GRADE-HARD' }))).toBe('HARD');
    expect(resolveCourseClearLamp(run({ gaugeType: 'DEATH', gauge: 'GRADE-DEATH' }))).toBe('NORMAL');
    expect(resolveCourseClearLamp(run())).toBe('NORMAL');
  });

  it('follows the class gauge under beatoraja and IIDX', () => {
    expect(resolveCourseClearLamp(run({ ruleset: 'beatoraja', gauge: 'CLASS' }))).toBe('NORMAL');
    expect(resolveCourseClearLamp(run({ ruleset: 'beatoraja', gauge: 'EXCLASS' }))).toBe('HARD');
    expect(resolveCourseClearLamp(run({ ruleset: 'iidx', gauge: 'EXHARDCLASS' }))).toBe('EX_HARD');
  });

  it('is a full combo when the course max combo covers every note, kept to the ruleset’s lamps', () => {
    expect(resolveCourseClearLamp(run({ maxCombo: 100 }))).toBe('FULL_COMBO');
    const max = run({ maxCombo: 100, judge: { great: 0, good: 0 } });
    expect(resolveCourseClearLamp(max)).toBe('FULL_COMBO');
    expect(resolveCourseClearLamp({ ...max, ruleset: 'beatoraja', gauge: 'CLASS' })).toBe('MAX');
    expect(resolveCourseClearLamp({ ...max, ruleset: 'beatoraja', judge: { great: 3, good: 0 } })).toBe('PERFECT');
  });

  it('reads an unknown ruleset’s gauge from the course gauge tables and stops it at FULL COMBO', () => {
    expect(resolveCourseClearLamp(run({ ruleset: 'be-music', gauge: 'COURSE-HARD' }))).toBe('HARD');
    expect(resolveCourseClearLamp(run({ ruleset: 'be-music', gauge: 'GRADE-DEATH' }))).toBe('HARD');
    expect(resolveCourseClearLamp(run({ ruleset: 'be-music', gauge: 'COURSE-EASY' }))).toBe('EASY');
    expect(resolveCourseClearLamp(run({ ruleset: 'be-music', maxCombo: 100, judge: { great: 0, good: 0 } }))).toBe(
      'FULL_COMBO',
    );
  });

  it('does not call a course without notes a full combo', () => {
    expect(resolveCourseClearLamp(run({ noteCount: 0, maxCombo: 0, gaugeType: 'HARD' }))).toBe('HARD');
  });
});

describe('resolveMissCount', () => {
  it('counts BADs, missed POORs and empty POORs', () => {
    // LR2 adds an empty POOR to its POOR count, so its BP includes them like beatoraja's.
    expect(resolveMissCount({ bad: 2, poor: 3, emptyPoor: 4 })).toBe(9);
  });

  it('adds the notes a play never judged', () => {
    expect(resolveMissCount({ bad: 2, poor: 3, emptyPoor: 1 }, 50)).toBe(56);
    expect(resolveMissCount({ bad: 2, poor: 3, emptyPoor: 1 }, -3)).toBe(6);
  });
});

it('awards LR2 FULL COMBO before a failed GROOVE gauge, while other rulesets still require a clear', () => {
  const play = { cleared: false, gauge: 'GROOVE', score: score(80, 15, 5) };
  expect(resolveClearLamp({ ...play, ruleset: 'lr2' })).toBe('FULL_COMBO');
  expect(resolveClearLamp({ ...play, ruleset: 'beatoraja' })).toBe('FAILED');
  expect(resolveClearLamp({ ...play, ruleset: 'iidx' })).toBe('FAILED');
  expect(resolveClearLamp({ ...play, ruleset: 'lr2', score: score(80, 15, 4) })).toBe('FAILED');
});
