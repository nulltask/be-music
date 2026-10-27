import { expect, test } from 'vite-plus/test';
import { resolvePoorBGAMode } from './index.ts';

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
