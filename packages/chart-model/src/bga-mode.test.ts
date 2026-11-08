import { expect, test } from 'vite-plus/test';
import { createEmptyJSON } from '@be-music/chart-source';
import { keysOutBGALayerBlack, resolvePoorBGAMode } from './index.ts';

test.each([
  [undefined, 0],
  ['', 0],
  ['0', 0],
  ['1', 1],
  [' 2 ', 2],
  ['02', 2],
  ['-1', 0],
  ['3', 0],
  ['x', 0],
] as const)('reads POOR BGA mode %s as %s', (value, expected) => expect(resolvePoorBGAMode(value)).toBe(expected));

test('keys out layer black for BMS images, and per slot in a chart of another format', () => {
  expect(keysOutBGALayerBlack({ sourceFormat: 'bms' })).toBe(true);
  expect(keysOutBGALayerBlack({ sourceFormat: 'bmson' })).toBe(false);
  const stitched = createEmptyJSON('bmson');
  stitched.resources.bmpSourceFormat = { a1: 'bms' };
  expect(keysOutBGALayerBlack(stitched, 'a1')).toBe(true);
  expect(keysOutBGALayerBlack(stitched, 'a2')).toBe(false);
  expect(keysOutBGALayerBlack(stitched)).toBe(false);
});
