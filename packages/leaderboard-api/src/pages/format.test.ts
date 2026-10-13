import { describe, expect, test } from 'vite-plus/test';
import { ClearLamp } from '../scoring/lamp.ts';
import {
  chartTitle,
  djLevel,
  formatExScore,
  formatGauge,
  formatRecorder,
  formatScoreRate,
  formatTimestamp,
  lampStyle,
} from './format.ts';

describe('page formatting', () => {
  test('names every lamp and falls back to NO PLAY', () => {
    expect(lampStyle(ClearLamp.HARD).label).toBe('HARD CLEAR');
    expect(lampStyle(ClearLamp.MAX).label).toBe('MAX');
    expect(lampStyle(0).label).toBe('NO PLAY');
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

  test('names the recording software from the play log recorder', () => {
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
