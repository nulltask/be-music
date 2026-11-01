import { describe, expect, it } from 'vite-plus/test';
import {
  DAN_RANKS,
  betterDanRank,
  danRankOrder,
  formatDanRank,
  isDanRank,
  mergeDanRankRecord,
  recognizeDanRank,
  resolveCourseRunDanRank,
} from './dan-rank.ts';

describe('DAN_RANKS / danRankOrder / isDanRank', () => {
  it('orders the kyu, dan, 中伝 / 皆伝, insane and Overjoy ranks lowest first', () => {
    expect(DAN_RANKS[0]).toBe('KYU_10');
    expect(danRankOrder('KYU_1')).toBeLessThan(danRankOrder('DAN_1'));
    expect(danRankOrder('DAN_10')).toBeLessThan(danRankOrder('CHUUDEN'));
    expect(danRankOrder('CHUUDEN')).toBeLessThan(danRankOrder('KAIDEN'));
    expect(danRankOrder('KAIDEN')).toBeLessThan(danRankOrder('INSANE_1'));
    expect(danRankOrder('INSANE_10')).toBeLessThan(danRankOrder('INSANE_KAIDEN'));
    expect(danRankOrder('INSANE_KAIDEN')).toBeLessThan(danRankOrder('OVERJOY'));
    expect(DAN_RANKS.at(-1)).toBe('OVERJOY');
  });

  it('accepts only the ladder’s names', () => {
    expect(isDanRank('DAN_7')).toBe(true);
    expect(isDanRank('DAN_11')).toBe(false);
    expect(isDanRank(7)).toBe(false);
    expect(isDanRank(undefined)).toBe(false);
  });
});

describe('betterDanRank', () => {
  it('keeps the higher rank, the current one on a tie', () => {
    expect(betterDanRank(undefined, 'DAN_3')).toBe('DAN_3');
    expect(betterDanRank('DAN_3', 'DAN_5')).toBe('DAN_5');
    expect(betterDanRank('INSANE_1', 'KAIDEN')).toBe('INSANE_1');
    expect(betterDanRank('DAN_5', 'DAN_5')).toBe('DAN_5');
  });
});

describe('recognizeDanRank', () => {
  it.each([
    ['初段', 'DAN_1'],
    ['七段', 'DAN_7'],
    ['十段', 'DAN_10'],
    ['中伝', 'CHUUDEN'],
    ['皆伝', 'KAIDEN'],
    ['七級', 'KYU_7'],
    ['一級', 'KYU_1'],
    ['十級', 'KYU_10'],
    ['発狂初段', 'INSANE_1'],
    ['発狂十段', 'INSANE_10'],
    ['発狂皆伝', 'INSANE_KAIDEN'],
    ['Overjoy', 'OVERJOY'],
    ['GENOSIDE 2018 段位認定 発狂初段', 'INSANE_1'],
    ['GENOSIDE 2018 段位認定 八段', 'DAN_8'],
    ['GENOSIDE 2018 段位認定 (^^) OVERJOY', 'OVERJOY'],
    ['7段', 'DAN_7'],
    ['１０段', 'DAN_10'],
    ['発狂 3 段', 'INSANE_3'],
  ] as const)('reads %s as %s', (name, rank) => {
    expect(recognizeDanRank(name)).toBe(rank);
  });

  it('names no rank for a course without one', () => {
    expect(recognizeDanRank('Satellite Skill Analyzer 2nd sl5')).toBeUndefined();
    expect(recognizeDanRank('段位認定 2018')).toBeUndefined();
    expect(recognizeDanRank('11段')).toBeUndefined();
    expect(recognizeDanRank('初級')).toBeUndefined();
    expect(recognizeDanRank('')).toBeUndefined();
  });

  it('does not read a year before 段位 as a grade', () => {
    expect(recognizeDanRank('2018段位認定 三段')).toBe('DAN_3');
  });
});

describe('formatDanRank', () => {
  it('names every rank as players write it', () => {
    expect(formatDanRank('KYU_7')).toBe('七級');
    expect(formatDanRank('DAN_1')).toBe('初段');
    expect(formatDanRank('DAN_10')).toBe('十段');
    expect(formatDanRank('CHUUDEN')).toBe('中伝');
    expect(formatDanRank('KAIDEN')).toBe('皆伝');
    expect(formatDanRank('INSANE_1')).toBe('発狂初段');
    expect(formatDanRank('INSANE_5')).toBe('発狂五段');
    expect(formatDanRank('INSANE_KAIDEN')).toBe('発狂皆伝');
    expect(formatDanRank('OVERJOY')).toBe('Overjoy');
  });

  it('round-trips through recognizeDanRank', () => {
    for (const rank of DAN_RANKS) expect(recognizeDanRank(formatDanRank(rank))).toBe(rank);
  });
});

describe('resolveCourseRunDanRank', () => {
  it('awards a cleared GRADE course the rank its name names', () => {
    expect(resolveCourseRunDanRank({ kind: 'grade', name: '発狂三段', lamp: 'NORMAL' })).toBe('INSANE_3');
    expect(resolveCourseRunDanRank({ kind: 'grade', name: '十段', lamp: 'EASY' })).toBe('DAN_10');
    expect(resolveCourseRunDanRank({ kind: 'grade', name: '皆伝', lamp: 'FULL_COMBO' })).toBe('KAIDEN');
  });

  it('awards nothing to a failed run, another course kind or an unranked name', () => {
    expect(resolveCourseRunDanRank({ kind: 'grade', name: '十段', lamp: 'FAILED' })).toBeUndefined();
    expect(resolveCourseRunDanRank({ kind: 'grade', name: '十段', lamp: 'NO_PLAY' })).toBeUndefined();
    expect(resolveCourseRunDanRank({ kind: 'expert', name: '十段', lamp: 'NORMAL' })).toBeUndefined();
    expect(resolveCourseRunDanRank({ kind: 'nonstop', name: '十段', lamp: 'NORMAL' })).toBeUndefined();
    expect(resolveCourseRunDanRank({ kind: 'grade', name: 'sl5', lamp: 'NORMAL' })).toBeUndefined();
  });
});

describe('mergeDanRankRecord', () => {
  it('keeps the higher rank with the course that first earned it', () => {
    const fifth = { rank: 'DAN_5' as const, course: 'A 五段' };
    expect(mergeDanRankRecord(undefined, fifth)).toEqual(fifth);
    expect(mergeDanRankRecord(fifth, { rank: 'DAN_6', course: 'A 六段' })).toEqual({ rank: 'DAN_6', course: 'A 六段' });
    expect(mergeDanRankRecord(fifth, { rank: 'DAN_4', course: 'A 四段' })).toBe(fifth);
    expect(mergeDanRankRecord(fifth, { rank: 'DAN_5', course: 'B 五段' })).toBe(fifth);
  });
});
