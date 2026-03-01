import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { clamp, clampInt, clampSignedUnit, gcd, lcm, resolveCliPath } from './index.ts';

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

test('gcd/lcm: 最大公約数と最小公倍数を計算できる', () => {
  expect(gcd(24, 18)).toBe(6);
  expect(gcd(0, 5)).toBe(5);
  expect(lcm(6, 8)).toBe(24);
  expect(lcm(0, 8)).toBe(0);
});
