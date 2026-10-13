import { describe, expect, test } from 'vite-plus/test';
import {
  COUNT_LABELS,
  countColumns,
  djRankGradient,
  ellipsize,
  fitFontSize,
  opticalInset,
  readableTextColor,
} from './score-card.ts';

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

  test('countColumns spaces the counts evenly and sets BP and the combo apart', () => {
    const columns = countColumns(72, 720, 24);
    expect(columns).toHaveLength(COUNT_LABELS.length);
    // (720 - 24) / 7 = 99.43 px a column, rounded to whole pixels; BP and the combo start 24 px later.
    expect(columns).toEqual([72, 171, 271, 370, 470, 593, 693]);
  });

  test("opticalInset pulls a line left by half the first glyph's average inset, within a limit", () => {
    // A straight stem (l, I) needs nothing.
    expect(opticalInset([10, 10, 10, 10], 50)).toBe(0);
    // A T: the crossbar row at 10, the stem 6 px in on the other three rows; the average inset is 4.5.
    expect(opticalInset([10, 16, 16, 16], 50)).toBe(2.25);
    // An A leans in a long way; 0.06 em caps it.
    expect(opticalInset([0, 10, 20, 30, 40], 50)).toBe(3);
    expect(opticalInset([], 50)).toBe(0);
  });

  test('AAA is gold, lower ranks fade', () => {
    expect(djRankGradient('AAA')[1]).toBe('#f5b301');
    expect(djRankGradient('F')).toEqual(djRankGradient('B'));
  });
});
