import { describe, expect, test } from 'vite-plus/test';
import { djRankGradient, ellipsize, fitFontSize, readableTextColor } from './score-card.ts';

// A stand-in for canvas measurement: every character is 0.6 em wide.
const measure = (text: string, size = 10) => [...text].length * size * 0.6;

describe('score card layout', () => {
  test('fitFontSize shrinks a long title until it fits, but not below the minimum', () => {
    expect(fitFontSize(measure, 'short', 700, 64, 40)).toBe(64);
    expect(fitFontSize(measure, 'x'.repeat(22), 700, 64, 40)).toBe(52);
    expect(fitFontSize(measure, 'x'.repeat(200), 700, 64, 40)).toBe(40);
  });

  test('ellipsize cuts whole characters, emoji included', () => {
    expect(ellipsize((text) => measure(text), 'fits', 100)).toBe('fits');
    // 36 / 6 = six characters, the ellipsis included.
    expect(ellipsize((text) => measure(text), 'あいうえおかきくけこ', 36)).toBe('あいうえお…');
    expect(ellipsize((text) => measure(text), '🎹🎹🎹🎹🎹', 24)).toBe('🎹🎹🎹…');
  });

  test('readableTextColor picks dark text on light lamps and white on dark ones', () => {
    expect(readableTextColor('#ffffff')).toBe('#0a0e18');
    expect(readableTextColor('#f5c518')).toBe('#0a0e18');
    expect(readableTextColor('#7a1f2b')).toBe('#ffffff');
    expect(readableTextColor('#3b82f6')).toBe('#ffffff');
  });

  test('AAA is gold, lower ranks fade', () => {
    expect(djRankGradient('AAA')[1]).toBe('#f5b301');
    expect(djRankGradient('F')).toEqual(djRankGradient('B'));
  });
});
