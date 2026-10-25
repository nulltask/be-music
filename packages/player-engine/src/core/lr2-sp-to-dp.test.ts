import { expect, test } from 'vite-plus/test';
import { splitLR2SPToDP, type LR2SplitObject } from './lr2-sp-to-dp.ts';

const object = (op: number, timeMs: number, value = 1): LR2SplitObject => ({ op, timeMs, value });
const options = { soundFamilies: Array.from({ length: 1296 }, (_, id) => id), playLevel: 12 };
const measure = (notes: LR2SplitObject[]) => [object(2, 0), ...notes, object(2, 4000)];

test('SP-TO-DP balances whole loader families by count with lower-ID ties, without duplicating or mutating notes', () => {
  const source = measure([object(11, 1000, 1), object(12, 1100, 2), object(11, 1200, 1)]);
  expect(splitLR2SPToDP(source, options)).toEqual([2, 11, 22, 11, 2]);
  expect(source.map((note) => note.op)).toEqual([2, 11, 12, 11, 2]);
  const tied = measure([object(11, 1000, 2), object(12, 1100, 1)]);
  expect(splitLR2SPToDP(tied, options)).toEqual([2, 21, 12, 2]);
});

test('single-family rows use the source two/three-lane fallback and four-lane alternation', () => {
  expect(splitLR2SPToDP(measure([object(11, 1000), object(12, 1100)]), options)).toEqual([2, 11, 22, 2]);
  expect(splitLR2SPToDP(measure([object(11, 1000), object(12, 1100), object(13, 1200)]), options)).toEqual([
    2, 11, 12, 23, 2,
  ]);
  expect(
    splitLR2SPToDP(measure([object(11, 1000), object(12, 1100), object(13, 1200), object(14, 1300)]), options),
  ).toEqual([2, 11, 22, 13, 24, 2]);
});

test('a repeated single lane stays on 1P, while one-note measures alternate across the course of the chart', () => {
  expect(splitLR2SPToDP(measure([object(11, 1000), object(11, 1200)]), options)).toEqual([2, 11, 11, 2]);
  const source = [
    object(2, 0),
    object(11, 1000),
    object(2, 2000),
    object(11, 3000),
    object(2, 4000),
    object(11, 5000),
    object(2, 6000),
  ];
  expect(splitLR2SPToDP(source, options)).toEqual([2, 11, 2, 21, 2, 11, 2]);
});

test('unrelated measures alternate their first family; continuing groups flip after four repeats', () => {
  const unrelated = [
    object(2, 0),
    object(11, 1000, 1),
    object(12, 1100, 2),
    object(2, 2000),
    object(13, 3000, 3),
    object(14, 3100, 4),
    object(2, 4000),
  ];
  expect(splitLR2SPToDP(unrelated, options)).toEqual([2, 11, 22, 2, 23, 14, 2]);
  const repeated = Array.from({ length: 5 }, (_, index) => [
    object(2, index * 2000),
    object(11, index * 2000 + 1000, 1),
    object(11, index * 2000 + 1100, 1),
    object(12, index * 2000 + 1200, 2),
  ]).flat();
  repeated.push(object(2, 10000));
  expect(splitLR2SPToDP(repeated, options).filter((_, index) => index % 4 === 1)).toEqual([11, 11, 11, 11, 21]);
});

test('dense-family thresholds use the original PLAYLEVEL and reset other families to 1P', () => {
  for (const [count, playLevel, split] of [
    [11, 8, false],
    [12, 8, true],
    [13, 9, false],
    [14, 9, true],
    [15, 10, false],
    [16, 10, true],
    [16, 11, false],
    [17, 12, true],
  ] as const) {
    const notes = Array.from({ length: count }, (_, index) => object(11 + (index % 4), 1000 + index * 20, 1));
    notes.push(object(15, 1500, 2));
    const result = splitLR2SPToDP(measure(notes), { ...options, playLevel });
    expect(result.at(-2), `${count} notes, level ${playLevel}`).toBe(split ? 15 : 25);
  }
});

test('scratch side uses strict 500 ms spacing and preserves its source dense-scratch exception', () => {
  for (const [second, expected] of [
    [1500, 20],
    [1501, 10],
  ] as const) {
    expect(splitLR2SPToDP(measure([object(10, 1000), object(10, second)]), options)).toEqual([2, 20, expected, 2]);
  }
  expect(splitLR2SPToDP(measure([1000, 2000, 3000, 3500].map((time) => object(10, time))), options)).toEqual([
    2, 20, 20, 20, 20, 2,
  ]);
});

test('the 200 ms scratch neighbourhood moves keys only without the matching source assist', () => {
  for (const [gap, assist2P, expected] of [
    [199, false, 13],
    [200, false, 23],
    [199, true, 23],
  ] as const) {
    const source = measure([object(11, 900), object(10, 1000), object(13, 1000 + gap)]);
    expect(splitLR2SPToDP(source, { ...options, assist2P })[3]).toBe(expected);
  }
  const source = measure([object(10, 100), object(12, 200), object(13, 300)]);
  expect(splitLR2SPToDP(source, options)[2]).toBe(22);
  expect(splitLR2SPToDP(source, { ...options, assist1P: true })[2]).toBe(12);
});

test('LN tails, hidden objects, BGM and other object families remain untouched', () => {
  const source = measure([object(11, 1000), object(51, 1500), object(31, 1600), object(1, 1700), object(4, 1800)]);
  expect(splitLR2SPToDP(source, options)).toEqual([2, 11, 51, 31, 1, 4, 2]);
});
