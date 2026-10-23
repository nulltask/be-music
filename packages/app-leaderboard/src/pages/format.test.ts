import { describe, expect, test } from 'vite-plus/test';
import { clearLampRank } from '@be-music/player-engine/ruleset';
import {
  chartTitle,
  difficultyName,
  djLevel,
  formatChartLevel,
  formatDelta,
  formatExScore,
  formatGauge,
  formatJudgeRank,
  formatLaneMode,
  formatLNMode,
  formatPercent,
  formatPlayTime,
  formatRecorder,
  formatScoreRate,
  formatTimestamp,
  LAMP_STYLES,
  lampStyle,
  rulesetName,
  shortLaneMode,
  showsGauge,
  verificationMeaning,
} from './format.ts';
import { ja } from './i18n/ja.ts';

describe('page formatting', () => {
  test('formatPlayTime keeps the two largest units', () => {
    expect(formatPlayTime(0)).toBe('0s');
    expect(formatPlayTime(48_900)).toBe('48s');
    expect(formatPlayTime(25 * 60_000 + 12_000)).toBe('25m 12s');
    expect(formatPlayTime(3 * 3_600_000 + 25 * 60_000 + 59_000)).toBe('3h 25m');
    // In the page's language.
    expect(formatPlayTime(25 * 60_000 + 12_000, ja.duration)).toBe('25 分 12 秒');
  });

  test('rulesetName names a ruleset as the rules a score is counted by, not as a player', () => {
    expect(rulesetName('lr2')).toBe('LR2 rules');
    expect(rulesetName('beatoraja')).toBe('beatoraja rules');
    expect(rulesetName('____')).toBe('???? rules');
    expect(rulesetName('unknown')).toBe('unknown rules');
  });

  test('names every lamp and falls back to NO PLAY', () => {
    expect(lampStyle(clearLampRank('HARD')).label).toBe('HARD CLEAR');
    expect(lampStyle(clearLampRank('MAX')).label).toBe('MAX');
    expect(lampStyle(0).label).toBe('NO PLAY');
  });

  test('keys lamps by the ranks results are stored with: FAILED 1 up to MAX 9', () => {
    expect(Object.keys(LAMP_STYLES).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(lampStyle(1).label).toBe('FAILED');
    expect(lampStyle(5).label).toBe('HARD CLEAR');
    expect(lampStyle(9).label).toBe('MAX');
  });

  test('formats the score rate and DJ LEVEL from the EX score and note count', () => {
    expect(formatScoreRate(1600, 1000)).toBe('80.00%');
    expect(formatScoreRate(10, 0)).toBe('-');
    expect(djLevel(2000, 1000)).toBe('AAA');
    expect(djLevel(1778, 1000)).toBe('AAA'); // 8/9 = 88.9 %
    expect(djLevel(1777, 1000)).toBe('AA');
    expect(djLevel(0, 1000)).toBe('F');
    expect(djLevel(5, 0)).toBe('-');
  });

  test('prints timestamps in UTC and titles with a fingerprint fallback', () => {
    expect(formatTimestamp(Date.UTC(2026, 9, 13, 5, 51, 14))).toBe('2026-10-13 05:51 UTC');
    expect(chartTitle('Song', 'bmfp0:abc')).toBe('Song');
    expect(chartTitle('  ', 'bmfp0:0123456789abcdef0123')).toBe('bmfp0:0123456789ab…');
    expect(chartTitle(null, 'bmfp0:0123456789abcdef0123')).toBe('bmfp0:0123456789ab…');
  });

  test('prints the final gauge with its type, or only the type when it was not recorded', () => {
    expect(formatGauge('GROOVE', 100)).toBe('GROOVE 100.0%');
    expect(formatGauge('HARD', 2.34)).toBe('HARD 2.3%');
    expect(formatGauge('NORMAL', null)).toBe('NORMAL');
  });

  test('names the recording software from the replay recorder', () => {
    expect(
      formatRecorder({ name: 'be-music-web', version: '0.5.0', build: '6471cd16', engine: '0.8.0', platform: 'web' }),
    ).toBe('be-music-web 0.5.0 (build 6471cd16, engine 0.8.0, web)');
    expect(formatRecorder({ engine: '0.8.0' })).toBe('unknown app (engine 0.8.0)');
    expect(formatRecorder(null)).toBe('unknown');
  });

  test('prints the EX-Score with its maximum and rate', () => {
    expect(formatExScore(81, 52)).toBe('81 / 104 (77.88%)');
    expect(formatExScore(5, 0)).toBe('5');
  });
});

describe('chart metadata', () => {
  test('formatLaneMode names key counts as players do', () => {
    expect(formatLaneMode('7keys')).toBe('7 KEYS');
    expect(formatLaneMode('14keys')).toBe('14 KEYS');
    expect(formatLaneMode('popn-9k')).toBe('POPN-9K');
    expect(formatLaneMode(null)).toBe('-');
  });

  test('formatJudgeRank shows the raw rank first, then the window', () => {
    expect(formatJudgeRank({ percent: 75, sourceRank: 2 })).toBe('#RANK 2 (NORMAL) · 75%');
    expect(formatJudgeRank({ percent: 90, sourceRank: 2, sourceExRank: 120 })).toBe('#DEFEXRANK 120 · 90%');
    expect(formatJudgeRank({ percent: 100 })).toBe('100%');
    expect(formatJudgeRank({ percent: 50, sourceRank: 9 })).toBe('#RANK 9 · 50%');
    expect(formatJudgeRank(null)).toBe('-');
  });

  test('formatLNMode and formatPercent', () => {
    expect([1, 2, 3, null].map((mode) => formatLNMode(mode).split(' ')[0])).toEqual(['LN', 'CN', 'HCN', '-']);
    expect(formatPercent(0.77884)).toBe('77.88%');
    expect(formatPercent(null)).toBe('-');
  });
});

describe('chart and play labels', () => {
  test('shortLaneMode writes the key count the way players do', () => {
    expect(
      ['7 KEY SP', '14 KEY DP', '5 KEY SP', '5 KEY DP', '9 KEY (PMS-STD)', '7keys', '48 KEY DP'].map(shortLaneMode),
    ).toEqual(['7K', '14K', '5K', '10K', '9K', '7K', '48K']);
    expect(shortLaneMode(null)).toBeUndefined();
    expect(shortLaneMode('popn-9k')).toBeUndefined();
  });

  test('formatChartLevel puts the mode and the level together, leaving out what is unknown', () => {
    expect(formatChartLevel('7 KEY SP', '12')).toBe('7K ☆12');
    expect(formatChartLevel('14 KEY DP', null)).toBe('14K');
    expect(formatChartLevel(null, '★5')).toBe('☆★5');
    expect(formatChartLevel(null, null)).toBeUndefined();
    expect(formatChartLevel('7 KEY SP', '')).toBe('7K');
  });

  test('difficultyName names #DIFFICULTY 1 to 5 only', () => {
    expect([1, 2, 3, 4, 5].map(difficultyName)).toEqual(['BEGINNER', 'NORMAL', 'HYPER', 'ANOTHER', 'INSANE']);
    expect(difficultyName(0)).toBeUndefined();
    expect(difficultyName(null)).toBeUndefined();
  });

  test('formatDelta signs a change with a real minus', () => {
    expect([23, -5, 0].map(formatDelta)).toEqual(['+23', '−5', '±0']);
  });

  test('showsGauge keeps the gauge for plays that did not clear', () => {
    expect(showsGauge(clearLampRank('FAILED'))).toBe(true);
    expect(showsGauge(clearLampRank('NORMAL'))).toBe(false);
    expect(showsGauge(clearLampRank('EASY'))).toBe(false);
  });

  test('verificationMeaning explains L3 and L4 and passes anything else through', () => {
    expect(verificationMeaning('L4')).toMatch(/^L4 — /);
    expect(verificationMeaning('L3')).toMatch(/^L3 — /);
    expect(verificationMeaning('L5')).toBe('L5');
  });
});
