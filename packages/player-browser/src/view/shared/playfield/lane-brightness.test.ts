import { expect, test } from 'vite-plus/test';
import { resolveLaneDim } from './lane-brightness.ts';

test('dims the lanes by what the brightness leaves out', () => {
  expect(resolveLaneDim(100)).toBe(0);
  expect(resolveLaneDim(70)).toBeCloseTo(0.3);
  expect(resolveLaneDim(0)).toBe(1);
});

test('leaves the lanes alone without a usable setting, and stays within 0 to 1', () => {
  expect(resolveLaneDim(undefined)).toBe(0);
  expect(resolveLaneDim(Number.NaN)).toBe(0);
  expect(resolveLaneDim(150)).toBe(0);
  expect(resolveLaneDim(-20)).toBe(1);
});
