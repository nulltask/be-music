import { describe, expect, test } from 'vite-plus/test';
import { normalizePositionDenominator, normalizePositionNumerator } from './beats.ts';

describe('event position normalization', () => {
  test('normalizePositionDenominator floors to a positive integer and treats invalid values as 1', () => {
    expect(normalizePositionDenominator(16)).toBe(16);
    expect(normalizePositionDenominator(7.9)).toBe(7);
    expect(normalizePositionDenominator(0.5)).toBe(1);
    expect(normalizePositionDenominator(0)).toBe(1);
    expect(normalizePositionDenominator(-4)).toBe(1);
    expect(normalizePositionDenominator(Number.NaN)).toBe(1);
    expect(normalizePositionDenominator(Number.POSITIVE_INFINITY)).toBe(1);
  });

  test('normalizePositionNumerator floors into the cells of the measure', () => {
    expect(normalizePositionNumerator(3, 16)).toBe(3);
    expect(normalizePositionNumerator(3.7, 16)).toBe(3);
    expect(normalizePositionNumerator(-2, 16)).toBe(0);
    expect(normalizePositionNumerator(16, 16)).toBe(15);
    expect(normalizePositionNumerator(Number.NaN, 16)).toBe(0);
  });
});
