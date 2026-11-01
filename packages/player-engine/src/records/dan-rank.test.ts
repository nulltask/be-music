import { describe, expect, it } from 'vite-plus/test';
import {
  DAN_RANKS,
  danRankOrder,
  formatDanRank,
  higherDanRank,
  isDanRank,
  resolveCourseDanRank,
  resolveCourseRunDanRank,
  resolveDanCourseKeyMode,
} from './dan-rank.ts';

describe('resolveCourseDanRank', () => {
  it('reads the kyu and dan ranks of Japanese course names', () => {
    expect(resolveCourseDanRank('十級')).toBe('kyu-10');
    expect(resolveCourseDanRank('段位認定 七級')).toBe('kyu-7');
    expect(resolveCourseDanRank('一級')).toBe('kyu-1');
    expect(resolveCourseDanRank('初段')).toBe('dan-1');
    expect(resolveCourseDanRank('GENOCIDE 2018 七段')).toBe('dan-7');
    expect(resolveCourseDanRank('十段')).toBe('dan-10');
    expect(resolveCourseDanRank('中伝')).toBe('chuden');
    expect(resolveCourseDanRank('段位認定 皆伝')).toBe('kaiden');
  });

  it('reads the insane ladder and Overjoy', () => {
    expect(resolveCourseDanRank('発狂初段')).toBe('insane-1');
    expect(resolveCourseDanRank('GENOCIDE 2018 発狂八段')).toBe('insane-8');
    expect(resolveCourseDanRank('発狂十段')).toBe('insane-10');
    expect(resolveCourseDanRank('発狂皆伝')).toBe('insane-kaiden');
    expect(resolveCourseDanRank('Overjoy')).toBe('overjoy');
    expect(resolveCourseDanRank('(^^) OVERJOY')).toBe('overjoy');
  });

  it('reads digits, full-width digits and English spellings', () => {
    expect(resolveCourseDanRank('7段')).toBe('dan-7');
    expect(resolveCourseDanRank('１０段')).toBe('dan-10');
    expect(resolveCourseDanRank('発狂３段')).toBe('insane-3');
    expect(resolveCourseDanRank('7th Dan')).toBe('dan-7');
    expect(resolveCourseDanRank('DAN 2')).toBe('dan-2');
    expect(resolveCourseDanRank('1st kyu')).toBe('kyu-1');
    expect(resolveCourseDanRank('Insane 5th dan')).toBe('insane-5');
    expect(resolveCourseDanRank('Insane Kaiden')).toBe('insane-kaiden');
  });

  it('names no rank for a name without one', () => {
    expect(resolveCourseDanRank('段位認定')).toBeUndefined();
    expect(resolveCourseDanRank('Bench Dan')).toBeUndefined();
    expect(resolveCourseDanRank('My Course')).toBeUndefined();
    expect(resolveCourseDanRank('発狂')).toBeUndefined();
    // An insane course names a dan, never a kyu.
    expect(resolveCourseDanRank('発狂七級')).toBeUndefined();
    expect(resolveCourseDanRank('11段')).toBeUndefined();
  });
});

describe('dan ladder', () => {
  it('orders the ranks from 10th kyu up to Overjoy', () => {
    expect(danRankOrder('kyu-10')).toBe(0);
    expect(danRankOrder('kyu-1')).toBeLessThan(danRankOrder('dan-1'));
    expect(danRankOrder('dan-10')).toBeLessThan(danRankOrder('chuden'));
    expect(danRankOrder('kaiden')).toBeLessThan(danRankOrder('insane-1'));
    expect(danRankOrder('insane-kaiden')).toBeLessThan(danRankOrder('overjoy'));
    expect(danRankOrder('overjoy')).toBe(DAN_RANKS.length - 1);
  });

  it('keeps the higher rank', () => {
    expect(higherDanRank(undefined, 'dan-3')).toBe('dan-3');
    expect(higherDanRank('dan-3', 'dan-7')).toBe('dan-7');
    expect(higherDanRank('insane-1', 'kaiden')).toBe('insane-1');
    expect(higherDanRank('dan-7', 'dan-7')).toBe('dan-7');
  });

  it('tells ranks apart from other values', () => {
    expect(isDanRank('dan-7')).toBe(true);
    expect(isDanRank('dan-11')).toBe(false);
    expect(isDanRank(7)).toBe(false);
  });

  it('labels every rank as dan courses are named, and reads its label back', () => {
    expect(formatDanRank('kyu-10')).toBe('十級');
    expect(formatDanRank('dan-1')).toBe('初段');
    expect(formatDanRank('dan-7')).toBe('七段');
    expect(formatDanRank('insane-1')).toBe('発狂初段');
    expect(formatDanRank('insane-kaiden')).toBe('発狂皆伝');
    expect(formatDanRank('overjoy')).toBe('Overjoy');
    for (const rank of DAN_RANKS) expect(resolveCourseDanRank(formatDanRank(rank))).toBe(rank);
  });
});

describe('resolveDanCourseKeyMode', () => {
  it('takes the declared key mode, else the one every stage shares', () => {
    expect(resolveDanCourseKeyMode(14, [7, 7])).toBe(14);
    expect(resolveDanCourseKeyMode(undefined, [7, 7, 7])).toBe(7);
    expect(resolveDanCourseKeyMode(undefined, [7, 14])).toBeUndefined();
    expect(resolveDanCourseKeyMode(undefined, [7, undefined])).toBeUndefined();
    expect(resolveDanCourseKeyMode(undefined, [])).toBeUndefined();
  });
});

describe('resolveCourseRunDanRank', () => {
  it('certifies the rank of a cleared GRADE course only', () => {
    expect(resolveCourseRunDanRank({ kind: 'grade', name: '七段', lamp: 'NORMAL' })).toBe('dan-7');
    expect(resolveCourseRunDanRank({ kind: 'grade', name: '七段', lamp: 'FULL_COMBO' })).toBe('dan-7');
    expect(resolveCourseRunDanRank({ kind: 'grade', name: '七段', lamp: 'FAILED' })).toBeUndefined();
    expect(resolveCourseRunDanRank({ kind: 'grade', name: '七段', lamp: 'NO_PLAY' })).toBeUndefined();
    expect(resolveCourseRunDanRank({ kind: 'expert', name: '七段', lamp: 'NORMAL' })).toBeUndefined();
    expect(resolveCourseRunDanRank({ kind: 'nonstop', name: '七段', lamp: 'NORMAL' })).toBeUndefined();
    expect(resolveCourseRunDanRank({ kind: 'grade', name: 'My Course', lamp: 'NORMAL' })).toBeUndefined();
  });
});
