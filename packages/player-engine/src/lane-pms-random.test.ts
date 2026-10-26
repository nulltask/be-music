import { expect, test } from 'vite-plus/test';
import { randomizePMSPlayableLanes } from './lane-pms-random.ts';
import type { SRandomNote } from './lane-random.ts';
const lanes = Array.from({ length: 9 }, (_, index) => `key${index}`);
const forbidden = [
  [0, 3, 6],
  [0, 3, 7],
  [0, 3, 8],
  [0, 4, 7],
  [0, 4, 8],
  [0, 5, 8],
  [1, 4, 7],
  [1, 4, 8],
  [1, 5, 8],
  [2, 5, 8],
];

test('uses the source permutation order and excludes regular and mirror when candidates exist', () => {
  const notes = lanes.map((channel, timeMs) => ({ channel, timeMs }));
  expect(randomizePMSPlayableLanes(notes, lanes, () => 0)).toEqual([lanes[1], lanes[0], ...lanes.slice(2)]);
  const result = randomizePMSPlayableLanes(notes, lanes, () => 0.999999);
  expect(result).not.toEqual(lanes);
  expect(result).not.toEqual([...lanes].reverse());
  expect([...result].sort()).toEqual([...lanes].sort());
});

test('avoids all ten source impossible triples across the chart', () => {
  const notes = forbidden.flatMap((chord, timeMs) => chord.map((index) => ({ channel: lanes[index]!, timeMs })));
  const original = structuredClone(notes);
  const result = randomizePMSPlayableLanes(notes, lanes, () => 0.35);
  for (let row = 0; row < forbidden.length; row += 1) {
    const chord = new Set(result.slice(row * 3, row * 3 + 3).map((channel) => lanes.indexOf(channel)));
    expect(forbidden.some((triple) => triple.every((lane) => chord.has(lane)))).toBe(false);
  }
  expect(notes).toEqual(original);
});

test.each([0, 0.99])('a seven-key chord falls back to regular or mirror (%s)', (draw) => {
  const notes = lanes.slice(0, 7).map((channel) => ({ channel, timeMs: 0 }));
  expect(randomizePMSPlayableLanes(notes, lanes, () => draw)).toEqual(
    draw < 0.5 ? lanes.slice(0, 7) : [...lanes].reverse().slice(0, 7),
  );
});

test('LN holds count toward chords but release at their exact tail timeline', () => {
  const notes: SRandomNote[] = lanes.slice(0, 6).map((channel) => ({ channel, timeMs: 0, endTimeMs: 10 }));
  notes.push({ channel: lanes[6]!, timeMs: 10 });
  expect(randomizePMSPlayableLanes(notes, lanes, () => 0)).not.toEqual(notes.map((note) => note.channel));
  notes.at(-1)!.timeMs = 5;
  expect(randomizePMSPlayableLanes(notes, lanes, () => 0)).toEqual(notes.map((note) => note.channel));
});

test('mines and invisible notes use the same permutation without restricting its chord candidates', () => {
  const notes: SRandomNote[] = lanes.map((channel) => ({ channel, timeMs: 0, kind: 'mine' }));
  notes.push({ channel: lanes[0]!, timeMs: 0, kind: 'invisible' }, { channel: 'outside', timeMs: 0 });
  const result = randomizePMSPlayableLanes(notes, lanes, () => 0);
  expect(result.slice(0, 9)).toEqual([lanes[1], lanes[0], ...lanes.slice(2)]);
  expect(result[9]).toBe(result[0]);
  expect(result[10]).toBe('outside');
});

test('rejects a non-nine-key domain', () => {
  expect(() => randomizePMSPlayableLanes([], lanes.slice(0, 5), () => 0)).toThrow(RangeError);
});
