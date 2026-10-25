import { expect, test, vi } from 'vite-plus/test';
import { randomizeLR2ScatterNotes } from './lane-scatter.ts';
import type { SRandomNote } from './lane-random.ts';

const FIVE = ['11', '12', '13', '14', '15'];
const SEVEN = [...FIVE, '18', '19'];
const note = (
  channel: string,
  timeMs: number,
  endTimeMs?: number,
  kind: SRandomNote['kind'] = 'note',
): SRandomNote => ({ channel, timeMs, ...(endTimeMs !== undefined ? { endTimeMs } : {}), kind });

test('avoids the preceding row rather than a BPM-based timing threshold', () => {
  const notes = [note('11', 100), note('11', 10000), note('11', 20000)];
  const original = structuredClone(notes);
  expect(randomizeLR2ScatterNotes(notes, FIVE, { random: () => 0 })).toEqual(['11', '12', '11']);
  expect(notes).toEqual(original);
});

test('full chords exhaust avoidance and reuse previous-row lanes without collisions or note loss', () => {
  const notes = [...FIVE.map((channel) => note(channel, 100)), ...FIVE.map((channel) => note(channel, 200))];
  expect(randomizeLR2ScatterNotes(notes, FIVE, { random: () => 0 })).toEqual([...FIVE, ...FIVE]);
});

test('LN destinations remain reserved through the exact tail, and retain preceding-row avoidance after release', () => {
  const notes = [note('11', 100, 300), note('12', 200), note('13', 300), note('14', 301), note('15', 400)];
  expect(randomizeLR2ScatterNotes(notes, FIVE, { random: () => 0 })).toEqual(['11', '12', '13', '12', '11']);
});

test('scratch-only rows reset the preceding key row, while hidden notes keep their source lanes and do not advance it', () => {
  const scratch = [note('11', 100), note('16', 200), note('11', 300)];
  expect(randomizeLR2ScatterNotes(scratch, FIVE, { random: () => 0 })).toEqual(['11', '16', '11']);
  const hidden = [note('11', 100), note('15', 200, undefined, 'invisible'), note('11', 300)];
  const random = vi.fn(() => 0);
  expect(randomizeLR2ScatterNotes(hidden, FIVE, { random })).toEqual(['11', '15', '12']);
  expect(random).toHaveBeenCalledTimes(2);
});

test('mines participate in the same row avoidance as visible notes', () => {
  expect(
    randomizeLR2ScatterNotes([note('11', 100, undefined, 'mine'), note('11', 200)], FIVE, { random: () => 0 }),
  ).toEqual(['11', '12']);
});

test('14KEY scratch masks preserve the source per-side key restrictions until the avoidance mask fills', () => {
  expect(
    randomizeLR2ScatterNotes([note('16', 100), ...FIVE.slice(0, 4).map((channel) => note(channel, 100))], SEVEN, {
      random: () => 0.999,
      doublePlay: true,
      side: '1P',
    }),
  ).toEqual(['16', '13', '12', '11', '19']);
  const lanes2P = SEVEN.map((channel) => '2' + channel[1]);
  expect(
    randomizeLR2ScatterNotes([note('26', 100), ...lanes2P.slice(0, 4).map((channel) => note(channel, 100))], lanes2P, {
      random: () => 0,
      doublePlay: true,
      side: '2P',
    }),
  ).toEqual(['26', '25', '28', '29', '21']);
});

test('DP FLIP keeps the original pre-flip side for source row bookkeeping', () => {
  const notes = [note('11', 100), note('11', 200), note('11', 300)];
  expect(randomizeLR2ScatterNotes(notes, FIVE, { random: () => 0, flipped: true })).toEqual(['11', '12', '13']);
  expect(randomizeLR2ScatterNotes([note('21', 150), ...notes], FIVE, { random: () => 0 })).toEqual([
    '21',
    '11',
    '12',
    '11',
  ]);
});

test('rejects impossible placements, unsupported domains and invalid randomness without mutating inputs', () => {
  const notes = [...FIVE.map((channel) => note(channel, 100)), note('11', 100)];
  const original = structuredClone(notes);
  expect(() => randomizeLR2ScatterNotes(notes, FIVE, { random: () => 0 })).toThrow(/no placement/);
  expect(notes).toEqual(original);
  expect(() => randomizeLR2ScatterNotes([], ['11', '12'], { random: () => 0 })).toThrow(/complete/);
  expect(() => randomizeLR2ScatterNotes([note('11', 100)], FIVE, { random: () => NaN })).toThrow();
});

const NINE = [...FIVE, '22', '23', '24', '25'];

test('original 9KEY includes the tenth destination and preserves its avoidance bit across rows', () => {
  const notes = [note('11', 100), note('22', 200), note('25', 300), note('12', 400)];
  expect(randomizeLR2ScatterNotes(notes, NINE, { random: () => 0.999 })).toEqual(['26', '25', '24', '25']);
  expect(notes.map(({ channel }) => channel)).toEqual(['11', '22', '25', '12']);
});

test('corrected 9KEY limits every destination to the nine playable lanes', () => {
  const notes = [note('11', 100), note('22', 200), note('25', 300)];
  expect(randomizeLR2ScatterNotes(notes, NINE, { random: () => 0.999, correctedNineKey: true })).toEqual([
    '25',
    '24',
    '25',
  ]);
  const chords = [...NINE.map((channel) => note(channel, 100)), ...NINE.map((channel) => note(channel, 200))];
  const result = randomizeLR2ScatterNotes(chords, NINE, { random: () => 0, correctedNineKey: true });
  expect(result).toEqual([...NINE, ...NINE]);
});

test('9KEY holds on the original tenth destination remain reserved through their tails', () => {
  const notes = [note('11', 100, 400), note('22', 200), note('25', 400), note('12', 401)];
  expect(randomizeLR2ScatterNotes(notes, NINE, { random: () => 0.999 })).toEqual(['26', '25', '24', '25']);
});

test('9KEY hidden objects neither move nor contribute row avoidance in either mode', () => {
  for (const correctedNineKey of [false, true]) {
    const random = vi.fn(() => 0);
    expect(
      randomizeLR2ScatterNotes([note('11', 100), note('22', 200, undefined, 'invisible'), note('25', 300)], NINE, {
        random,
        correctedNineKey,
      }),
    ).toEqual(['11', '22', '12']);
    expect(random).toHaveBeenCalledTimes(2);
  }
});

test('the alternate BME nine-key encoding uses the same original tenth destination', () => {
  const lanes = ['11', '12', '13', '14', '15', '16', '17', '18', '19'];
  expect(randomizeLR2ScatterNotes([note('16', 100)], lanes, { random: () => 0.999 })).toEqual(['26']);
  expect(randomizeLR2ScatterNotes([note('16', 100)], lanes, { random: () => 0.999, correctedNineKey: true })).toEqual([
    '19',
  ]);
});
