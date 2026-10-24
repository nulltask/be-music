import { expect, test } from 'vite-plus/test';
import { createBeatorajaLaneRandom, drawLaneRandomIndex, parseLaneRandomSeed } from './lane-random-source.ts';

test('accepts the complete source long range and normalizes decimal seeds without precision loss', () => {
  expect(parseLaneRandomSeed('-1')).toBe('-1');
  expect(parseLaneRandomSeed(' 00042 ')).toBe('42');
  expect(parseLaneRandomSeed('9223372036854775807')).toBe('9223372036854775807');
  for (const invalid of ['9223372036854775808', '-2', '1.5', '1e3', 'abc', NaN, 9007199254740992])
    expect(parseLaneRandomSeed(invalid)).toBeUndefined();
});

test('matches java.util.Random seed-zero doubles and bounded integer fixtures', () => {
  const random = createBeatorajaLaneRandom('0');
  expect(random()).toBe(0.730967787376657);
  expect(random()).toBe(0.24053641567148587);
  const integers = createBeatorajaLaneRandom('0');
  expect(Array.from({ length: 5 }, () => integers.nextInt!(100))).toEqual([60, 48, 29, 47, 15]);
});

test('restarts exactly for the same long seed and uses Java bounded draws instead of double scaling', () => {
  const first = createBeatorajaLaneRandom('9223372036854775807');
  const second = createBeatorajaLaneRandom('9223372036854775807');
  for (const bound of [1, 2, 7, 9, 26, 52, 1073741825, 2147483647])
    expect(drawLaneRandomIndex(bound, first)).toBe(drawLaneRandomIndex(bound, second));
  expect(drawLaneRandomIndex(100, createBeatorajaLaneRandom('0'))).toBe(60);
  expect(drawLaneRandomIndex(100, () => 0.730967787376657)).toBe(73);
});

test('rejects unresolved seeds and invalid bounds or random draws', () => {
  expect(() => createBeatorajaLaneRandom('-1')).toThrow(RangeError);
  expect(() => createBeatorajaLaneRandom('bad')).toThrow(RangeError);
  expect(() => drawLaneRandomIndex(0, () => 0)).toThrow(RangeError);
  expect(() => drawLaneRandomIndex(3, () => 1)).toThrow(RangeError);
  expect(() => createBeatorajaLaneRandom('0').nextInt!(2147483648)).toThrow(RangeError);
});
