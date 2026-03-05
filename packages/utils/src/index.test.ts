import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  clamp,
  clampSignedUnit,
  findLastIndexAtOrBefore,
  findLastIndexBefore,
  gcd,
  lcm,
  normalizeAsciiBase36Code,
  normalizeFractionNumerator,
  normalizeNonNegativeInt,
  normalizePositiveInt,
  resolveCliPath,
} from './index.ts';
describe('utils', () => {


test('resolveCliPath: resolves to an absolute path from the specified cwd', () => {
  expect(resolveCliPath('chart/test.bms', '/tmp')).toBe(resolve('/tmp', 'chart/test.bms'));
});

test('clamp/clampSignedUnit: clamps values to configured ranges', () => {
  expect(clamp(4, 0, 3)).toBe(3);
  expect(clamp(-2, 0, 3)).toBe(0);
  expect(clampSignedUnit(1.5)).toBe(1);
  expect(clampSignedUnit(-2)).toBe(-1);
});

test('normalizeNonNegativeInt/normalizePositiveInt: normalizes integer values', () => {
  expect(normalizeNonNegativeInt(4.9)).toBe(4);
  expect(normalizeNonNegativeInt(-1.2)).toBe(0);
  expect(normalizeNonNegativeInt(Number.NaN, 7)).toBe(7);
  expect(normalizeNonNegativeInt(Number.POSITIVE_INFINITY, 9)).toBe(9);
  expect(normalizeNonNegativeInt(Number.NEGATIVE_INFINITY, 4)).toBe(4);
  expect(normalizePositiveInt(9.8)).toBe(9);
  expect(normalizePositiveInt(0.1)).toBe(1);
  expect(normalizePositiveInt(-5, 3)).toBe(3);
  expect(normalizePositiveInt(Number.NaN, 5)).toBe(5);
  expect(normalizePositiveInt(Number.POSITIVE_INFINITY, 6)).toBe(6);
});

test('normalizeFractionNumerator: normalizes fractional numerators into range', () => {
  expect(normalizeFractionNumerator(3.9, 8)).toBe(3);
  expect(normalizeFractionNumerator(-2, 8)).toBe(0);
  expect(normalizeFractionNumerator(99, 8)).toBe(7);
  expect(normalizeFractionNumerator(2.8, 3.9)).toBe(2);
  expect(normalizeFractionNumerator(10, Number.NaN)).toBe(0);
  expect(normalizeFractionNumerator(10, -3)).toBe(0);
  expect(normalizeFractionNumerator(Number.NaN, 8, 2)).toBe(2);
  expect(normalizeFractionNumerator(Number.POSITIVE_INFINITY, 8, 3)).toBe(3);
  expect(normalizeFractionNumerator(4, 0)).toBe(0);
});

test('gcd/lcm: computes greatest common divisor and least common multiple', () => {
  expect(gcd(24, 18)).toBe(6);
  expect(gcd(-24, 18)).toBe(6);
  expect(gcd(0, 5)).toBe(5);
  expect(lcm(6, 8)).toBe(24);
  expect(lcm(-6, 8)).toBe(24);
  expect(lcm(0, 8)).toBe(0);
});

test('findLastIndexAtOrBefore/findLastIndexBefore: returns binary-search index bounds', () => {
  const values = [{ beat: 1 }, { beat: 3 }, { beat: 3 }, { beat: 7 }];
  expect(findLastIndexAtOrBefore(values, 0, (item) => item.beat)).toBe(-1);
  expect(findLastIndexAtOrBefore(values, 3, (item) => item.beat)).toBe(2);
  expect(findLastIndexAtOrBefore(values, 8, (item) => item.beat)).toBe(3);
  expect(findLastIndexBefore(values, 1, (item) => item.beat)).toBe(-1);
  expect(findLastIndexBefore(values, 3, (item) => item.beat)).toBe(0);
  expect(findLastIndexBefore(values, 8, (item) => item.beat)).toBe(3);
});

test('normalizeAsciiBase36Code: normalizes ASCII 0-9/A-Z/a-z to uppercase base36 codes', () => {
  expect(normalizeAsciiBase36Code(0x30)).toBe(0x30);
  expect(normalizeAsciiBase36Code(0x39)).toBe(0x39);
  expect(normalizeAsciiBase36Code(0x41)).toBe(0x41);
  expect(normalizeAsciiBase36Code(0x5a)).toBe(0x5a);
  expect(normalizeAsciiBase36Code(0x61)).toBe(0x41);
  expect(normalizeAsciiBase36Code(0x7a)).toBe(0x5a);
  expect(normalizeAsciiBase36Code(0x2d)).toBe(-1);
});
});
