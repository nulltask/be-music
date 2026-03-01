import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  clamp,
  clampInt,
  clampSignedUnit,
  gcd,
  lcm,
  normalizeFractionNumerator,
  normalizeNonNegativeInt,
  normalizePositiveInt,
  resolveCliPath,
} from './index.ts';
describe('utils', () => {


test('resolveCliPath: resolves to an absolute path from the specified cwd', () => {
  expect(resolveCliPath('chart/test.bms', '/tmp')).toBe(resolve('/tmp', 'chart/test.bms'));
});

test('clamp/clampInt/clampSignedUnit: clamps values to configured ranges', () => {
  expect(clamp(4, 0, 3)).toBe(3);
  expect(clamp(-2, 0, 3)).toBe(0);
  expect(clampInt(10.7, 0, 8)).toBe(8);
  expect(clampInt(Number.NaN, 2, 5)).toBe(2);
  expect(clampSignedUnit(1.5)).toBe(1);
  expect(clampSignedUnit(-2)).toBe(-1);
});

test('normalizeNonNegativeInt/normalizePositiveInt: normalizes integer values', () => {
  expect(normalizeNonNegativeInt(4.9)).toBe(4);
  expect(normalizeNonNegativeInt(-1.2)).toBe(0);
  expect(normalizeNonNegativeInt(Number.NaN, 7)).toBe(7);
  expect(normalizePositiveInt(9.8)).toBe(9);
  expect(normalizePositiveInt(0.1)).toBe(1);
  expect(normalizePositiveInt(Number.NaN, 5)).toBe(5);
});

test('normalizeFractionNumerator: normalizes fractional numerators into range', () => {
  expect(normalizeFractionNumerator(3.9, 8)).toBe(3);
  expect(normalizeFractionNumerator(-2, 8)).toBe(0);
  expect(normalizeFractionNumerator(99, 8)).toBe(7);
  expect(normalizeFractionNumerator(Number.NaN, 8, 2)).toBe(2);
  expect(normalizeFractionNumerator(4, 0)).toBe(0);
});

test('gcd/lcm: computes greatest common divisor and least common multiple', () => {
  expect(gcd(24, 18)).toBe(6);
  expect(gcd(0, 5)).toBe(5);
  expect(lcm(6, 8)).toBe(24);
  expect(lcm(0, 8)).toBe(0);
});
});
