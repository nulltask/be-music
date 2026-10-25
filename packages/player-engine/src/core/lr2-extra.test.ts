import { expect, test } from 'vite-plus/test';
import { applyLR2Extra, type LR2ExtraObject } from './lr2-extra.ts';

const object = (timeMs: number, op: number, value = 1): LR2ExtraObject => ({ timeMs, position: timeMs, op, value });
const options = { keyMode: 7, level: 0, initialBPM: 120, soundFamilies: [0, 1] } as const;
const marker = object(2100, 4, 0);

test('LR2 EXTRA converts a BGM using the authored preferred lane without mutating the input', () => {
  const source = [object(0, 11), object(500, 1), object(2000, 11), marker];
  expect(applyLR2Extra(source, options)).toEqual({ ops: [11, 11, 11, 4], level: 0, changes: 1 });
  expect(source[1]!.op).toBe(1);
});

test('neighbour reservations use a strict gap: equality is free, one millisecond inside moves the note', () => {
  for (const [time, expected] of [
    [499, 12],
    [500, 11],
  ] as const) {
    expect(applyLR2Extra([object(0, 11), object(time, 1), object(2000, 11), marker], options).ops[1]).toBe(expected);
  }
});

test('selected EXTRA minimum levels determine the initial gap and honour the 125 ms floor', () => {
  const source = [object(0, 11), object(300, 1), object(2000, 11), marker];
  expect(([0, 1, 2] as const).map((level) => applyLR2Extra(source, { ...options, level }).ops[1])).toEqual([
    12, 12, 11,
  ]);
  expect(
    applyLR2Extra([object(0, 11), object(124, 1), object(2000, 11), marker], { ...options, initialBPM: 1000, level: 2 })
      .ops[1],
  ).toBe(12);
  expect(
    applyLR2Extra([object(0, 11), object(125, 1), object(2000, 11), marker], { ...options, initialBPM: 1000, level: 2 })
      .ops[1],
  ).toBe(11);
});

test('an authored object on the same row is reserved; sample-id parity changes the fallback direction', () => {
  for (const [sound, expected] of [
    [1, 14],
    [2, 12],
  ] as const) {
    const source = [
      object(0, 13, sound),
      object(1000, 1, sound),
      object(1000, 13, sound),
      object(2000, 13, sound),
      marker,
    ];
    expect(applyLR2Extra(source, options).ops[1]).toBe(expected);
  }
});

test('BPM changes use the highest-level half-beat gap, independent of the selected minimum', () => {
  const source = [object(0, 11), object(300, 1), object(300, 8, 240), object(2000, 11), marker];
  expect(applyLR2Extra(source, options).ops[1]).toBe(11);
});

test('the first object of a new timestamp is skipped by the source row-collection branch', () => {
  const source = [object(0, 11), object(100, 8, 240), object(300, 1), object(2000, 11), marker];
  expect(applyLR2Extra(source, options).ops[2]).toBe(12);
});

test('EXTRA does not invent a final flush or add BGM beyond the last ordinary object', () => {
  expect(applyLR2Extra([object(0, 11), object(1000, 1)], options).ops).toEqual([11, 1]);
  expect(applyLR2Extra([object(0, 11), object(1000, 1), object(1100, 4)], options).ops).toEqual([11, 1, 4]);
});

test('long-note tail ops do not reserve a hold or establish a preferred normal lane', () => {
  const source = [object(0, 11), object(200, 51), object(1000, 1), object(1200, 51), object(2000, 11), marker];
  expect(applyLR2Extra(source, options).ops[2]).toBe(11);
  expect(applyLR2Extra([object(0, 51), object(1000, 1), marker], options).ops[1]).toBe(1);
});

test('DP converts ordinary scratch notes to BGM before choosing preferred lanes', () => {
  expect(applyLR2Extra([object(0, 10), object(0, 20), object(1000, 4)], { ...options, keyMode: 14 })).toEqual({
    ops: [1, 1, 4],
    level: 0,
    changes: 2,
  });
});

test('DP alternates converted BGM starting on 2P, regardless of the preferred side', () => {
  const source = [object(0, 11), object(0, 21), object(1000, 1), object(1000, 1), object(2000, 11), marker];
  expect(applyLR2Extra(source, { ...options, keyMode: 14 }).ops.slice(2, 4)).toEqual([21, 11]);
});

test('unknown sound families and scratch fallback do not acquire an invented key destination', () => {
  const source = [object(0, 10), object(1000, 1), object(1000, 10), object(2000, 11, 2), marker];
  expect(applyLR2Extra(source, options).ops[1]).toBe(1);
});

function denseDP(preferred: number): LR2ExtraObject[] {
  return [
    object(0, 10 + preferred),
    object(100, 10 + preferred),
    object(200, 10 + preferred),
    object(1000, 1),
    ...[0, 10].flatMap((side) => Array.from({ length: 7 }, (_, key) => object(1000, 11 + side + key, 2))),
    object(2000, 4),
  ];
}

test('the beta3 lane-21 alias is its nonzero direction, so a full DP row stays BGM', () => {
  expect(applyLR2Extra(denseDP(4), { ...options, keyMode: 14 }).ops[3]).toBe(1);
});

test('a DP search into uninitialized native stack data fails explicitly instead of choosing an invented lane', () => {
  expect(() => applyLR2Extra(denseDP(7), { ...options, keyMode: 14 })).toThrow(/outside its native lane table/);
});
