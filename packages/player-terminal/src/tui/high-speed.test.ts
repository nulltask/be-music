import { expect, test } from 'vite-plus/test';
import { resolveVisibleBeatsForTUIGrid } from './high-speed.ts';

test('authored spacing uses the full native range and precision while user mode retains its limits', () => {
  expect(resolveVisibleBeatsForTUIGrid(16, 0.25, true)).toBe(16);
  expect(resolveVisibleBeatsForTUIGrid(16, 0.77, true)).toBeCloseTo(4 / 0.77);
  expect(resolveVisibleBeatsForTUIGrid(16, 100, true)).toBe(0.04);
  expect(resolveVisibleBeatsForTUIGrid(16, 0.25)).toBe(8);
  expect(resolveVisibleBeatsForTUIGrid(16, 100)).toBe(0.4);
  expect(resolveVisibleBeatsForTUIGrid(16, NaN, true)).toBe(4);
});
