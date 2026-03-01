import { resolve } from 'node:path';
import { expect, test } from 'vitest';
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

test('resolveCliPath: 指定 cwd 基準で絶対パス化できる', () => {
  expect(resolveCliPath('chart/test.bms', '/tmp')).toBe(resolve('/tmp', 'chart/test.bms'));
});

test('clamp/clampInt/clampSignedUnit: 範囲制限できる', () => {
  expect(clamp(4, 0, 3)).toBe(3);
  expect(clamp(-2, 0, 3)).toBe(0);
  expect(clampInt(10.7, 0, 8)).toBe(8);
  expect(clampInt(Number.NaN, 2, 5)).toBe(2);
  expect(clampSignedUnit(1.5)).toBe(1);
  expect(clampSignedUnit(-2)).toBe(-1);
});

test('normalizeNonNegativeInt/normalizePositiveInt: 整数正規化できる', () => {
  expect(normalizeNonNegativeInt(4.9)).toBe(4);
  expect(normalizeNonNegativeInt(-1.2)).toBe(0);
  expect(normalizeNonNegativeInt(Number.NaN, 7)).toBe(7);
  expect(normalizePositiveInt(9.8)).toBe(9);
  expect(normalizePositiveInt(0.1)).toBe(1);
  expect(normalizePositiveInt(Number.NaN, 5)).toBe(5);
});

test('normalizeFractionNumerator: 分数分子を範囲正規化できる', () => {
  expect(normalizeFractionNumerator(3.9, 8)).toBe(3);
  expect(normalizeFractionNumerator(-2, 8)).toBe(0);
  expect(normalizeFractionNumerator(99, 8)).toBe(7);
  expect(normalizeFractionNumerator(Number.NaN, 8, 2)).toBe(2);
  expect(normalizeFractionNumerator(4, 0)).toBe(0);
});

test('gcd/lcm: 最大公約数と最小公倍数を計算できる', () => {
  expect(gcd(24, 18)).toBe(6);
  expect(gcd(0, 5)).toBe(5);
  expect(lcm(6, 8)).toBe(24);
  expect(lcm(0, 8)).toBe(0);
});
