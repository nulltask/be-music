import { describe, expect, test } from 'vite-plus/test';
import { ClearLamp } from '../scoring/lamp.ts';
import { chartTitle, djLevel, formatScoreRate, formatTimestamp, lampStyle } from './format.ts';

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
});
