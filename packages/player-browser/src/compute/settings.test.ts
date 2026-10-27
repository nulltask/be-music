import { expect, test } from 'vite-plus/test';
import { defaultBrowserWorkerCount, normalizeBrowserWorkerCount } from './index.ts';
test('defaults to half the reported logical CPUs, rounded down and at least one', () => {
  for (const [cores, count] of [
    [1, 1],
    [2, 1],
    [3, 1],
    [8, 4],
    [16, 8],
    [0, 1],
    [NaN, 1],
    [Infinity, 1],
  ] as const)
    expect(defaultBrowserWorkerCount(cores)).toBe(count);
  expect(defaultBrowserWorkerCount(undefined)).toBe(1);
});
test('accepts positive integer overrides; rejects fractions and invalid settings', () => {
  expect(normalizeBrowserWorkerCount(3, 16)).toBe(3);
  for (const value of [0, -1, 1.5, NaN, Infinity]) expect(normalizeBrowserWorkerCount(value, 8)).toBe(4);
});
