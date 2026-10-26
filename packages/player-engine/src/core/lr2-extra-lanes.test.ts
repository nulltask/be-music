import { expect, test } from 'vite-plus/test';
import { resolveLR2ExtraLevel, resolveLR2ExtraSoundLanes } from './lr2-extra-lanes.ts';

test('LR2 EXTRA raises each selected minimum at the source 1000/1200 boundaries', () => {
  expect([0, 999, 1000, 1199, 1200].map((count) => resolveLR2ExtraLevel(0, count))).toEqual([0, 0, 1, 1, 2]);
  expect([0, 999, 1000, 1199, 1200].map((count) => resolveLR2ExtraLevel(1, count))).toEqual([1, 1, 2, 2, 2]);
  expect([0, 999, 1000, 1199, 1200].map((count) => resolveLR2ExtraLevel(2, count))).toEqual([2, 2, 2, 2, 2]);
});

test('preferred sound lanes use strict maxima, lower-lane ties and only ordinary raw ops', () => {
  const lanes = resolveLR2ExtraSoundLanes(
    [
      { op: 13, value: 1 },
      { op: 11, value: 1 },
      { op: 13, value: 2 },
      { op: 13, value: 2 },
      { op: 11, value: 2 },
      { op: 51, value: 3 },
      { op: 31, value: 3 },
      { op: 30, value: 3 },
      { op: 1, value: 4 },
      { op: 11, value: 1296 },
    ],
    7,
    [0, 1, 2, 3, 4],
  );
  expect(lanes.slice(0, 5)).toEqual([-1, 1, 3, -1, -1]);
});

test('only an active loader family inherits from the preceding sound, including a different family', () => {
  const lanes = resolveLR2ExtraSoundLanes(
    [
      { op: 11, value: 1 },
      { op: 12, value: 3 },
    ],
    7,
    [0, 1, 1, 3, 1, 5],
  );
  expect(lanes.slice(0, 6)).toEqual([-1, 1, 3, 2, 4, -1]);
});

test('an active family with no preceding usable lane uses the source fallback seven', () => {
  const families = Array.from({ length: 1296 }, (_, index) => index);
  families[4] = 1;
  expect(resolveLR2ExtraSoundLanes([{ op: 11, value: 1 }], 5, families)[4]).toBe(7);
});

test('each key mode follows its own source sound-id rotation, including seven-key lane six', () => {
  for (const mode of [5, 7, 9, 10, 14] as const) {
    const count = mode === 9 ? 9 : mode === 5 || mode === 10 ? 5 : 7;
    const families = Array.from({ length: 1296 }, (_, index) => index);
    const objects = Array.from({ length: count }, (_, index) => ({ op: index + 11, value: index * 2 + 1 }));
    for (let lane = 1; lane <= count; lane++) families[lane * 2] = lane * 2 - 1;
    const lanes = resolveLR2ExtraSoundLanes(objects, mode, families);
    const expected = count === 9 ? [3, 5, 7, 9, 2, 4, 6, 8, 1] : count === 5 ? [3, 4, 5, 1, 2] : [3, 4, 5, 6, 7, 3, 2];
    expect(
      expected.map((_, index) => lanes[index * 2 + 2]),
      `${mode}KEY`,
    ).toEqual(expected);
  }
});

test('a preceding 2P lane outside a rotation table does not receive an invented wrap', () => {
  const families = Array.from({ length: 1296 }, (_, index) => index);
  families[2] = 1;
  expect(resolveLR2ExtraSoundLanes([{ op: 21, value: 1 }], 14, families).slice(1, 3)).toEqual([11, -1]);
});
