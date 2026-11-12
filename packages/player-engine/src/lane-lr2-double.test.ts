import { expect, test } from 'vite-plus/test';
import { randomizeLR2DoubleNotes, sortLR2Objects } from './lane-lr2-double.ts';

const keys = ['11', '12', '13', '14', '15', '18', '19'];
const scratch = '16';
const row = { timeMs: 1000, op: 2 };

test('the LR2 CRT sort changes equal-time order depending on surrounding objects', () => {
  const pair = [
    { timeMs: 1000, op: 10 },
    { timeMs: 1000, op: 11 },
  ];
  const compare = (a: typeof row, b: typeof row) => Math.trunc(a.timeMs - b.timeMs);
  sortLR2Objects(pair, compare);
  expect(pair.map(({ op }) => op)).toEqual([11, 10]);
  const surrounded = [
    ...[100, 110, 120, 130].map((timeMs) => ({ timeMs, op: 12 })),
    ...pair.slice().reverse(),
    ...[1100, 1200, 1300, 1400].map((timeMs) => ({ timeMs, op: 12 })),
  ];
  sortLR2Objects(surrounded, compare);
  expect(surrounded.filter(({ timeMs }) => timeMs === 1000).map(({ op }) => op)).toEqual([10, 11]);
});

test('LR2 14 KEY accepts a far draw after every near key has been marked', () => {
  // Five equal-time records short-sort from [bar, scratch, 1, 2, 3] to [scratch, 1, 2, 3, bar].
  // The last note is the fourth key and can take a far destination.
  const notes = [scratch, ...keys.slice(0, 4)].map((channel) => ({ channel, timeMs: 1000 }));
  const draws = [0.02, 0.16, 0.3, 0.95];
  expect(randomizeLR2DoubleNotes(notes, keys, { scratch, objects: [row], random: () => draws.shift()! })).toEqual([
    scratch,
    '11',
    '12',
    '13',
    '19',
  ]);
});

test('a held unmarked near key prevents the all-marked fallback through its tail', () => {
  const notes = [
    { channel: '11', timeMs: 0, endTimeMs: 1000 },
    ...[scratch, ...keys.slice(0, 3)].map((channel) => ({ channel, timeMs: 1000 })),
  ];
  const draws = [0.02, 0.16, 0.3];
  expect(() => randomizeLR2DoubleNotes(notes, keys, { scratch, objects: [row], random: () => draws.shift()! })).toThrow(
    'no acceptable destination',
  );
});

test('DP FLIP resets the destination marks when the original side advances', () => {
  const notes = [
    { channel: '16', timeMs: 1000 },
    { channel: '11', timeMs: 1500 },
    { channel: '21', timeMs: 1750 },
    { channel: '11', timeMs: 2000 },
  ];
  const draws = [0.95, 0.02, 0.95];
  expect(randomizeLR2DoubleNotes(notes, keys, { scratch, flipped: true, random: () => draws.shift()! })).toEqual([
    scratch,
    '11',
    '21',
    '19',
  ]);
});
