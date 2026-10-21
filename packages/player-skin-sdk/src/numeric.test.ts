import { expect, test } from 'vite-plus/test';
import { clamp } from './index.ts';

test.each([
  [-1, 0],
  [0.5, 0.5],
  [2, 1],
  [Infinity, 1],
  [-Infinity, 0],
])('SDK clamp limits %s to %s', (value, expected) => {
  expect(clamp(value, 0, 1)).toBe(expected);
});

test('SDK clamp preserves NaN for the caller to handle', () => {
  expect(clamp(NaN, 0, 1)).toBeNaN();
});
