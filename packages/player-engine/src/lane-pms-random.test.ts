import { expect, test } from 'vite-plus/test';
import { chordTriples, randomizePMSPlayableLanes } from './lane-pms-random.ts';
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

test('splits a chord into its three-lane subsets', () => {
  expect(chordTriples(0b111)).toEqual([[0, 1, 2]]);
  expect(chordTriples((1 << 0) | (1 << 3) | (1 << 6) | (1 << 8))).toEqual([
    [0, 3, 6],
    [0, 3, 8],
    [0, 6, 8],
    [3, 6, 8],
  ]);
  expect(chordTriples(0b11)).toEqual([]);
});

/** The search as it was before checking chords through their three-lane subsets: the reference for equivalence. */
function referencePermutation(notes: readonly SRandomNote[], draw: number): number[] {
  const masks = forbidden.map((chord) => chord.reduce((mask, lane) => mask | (1 << lane), 0));
  const rows = new Map<number, SRandomNote[]>();
  for (const note of notes) {
    if ((note.kind ?? 'note') !== 'note') continue;
    rows.set(note.timeMs, [...(rows.get(note.timeMs) ?? []), note]);
    if (note.endTimeMs !== undefined && note.endTimeMs > note.timeMs && !rows.has(note.endTimeMs))
      rows.set(note.endTimeMs, []);
  }
  const patterns = new Set<number>();
  const held = new Map<number, number>();
  let impossible = false;
  for (const [timeMs, row] of [...rows].sort(([a], [b]) => a - b)) {
    for (const [lane, endMs] of held) if (endMs <= timeMs) held.delete(lane);
    const chord = new Set(held.keys());
    for (const note of row) {
      const lane = lanes.indexOf(note.channel);
      chord.add(lane);
      if (note.endTimeMs !== undefined && note.endTimeMs > timeMs) held.set(lane, note.endTimeMs);
    }
    if (chord.size >= 7) {
      impossible = true;
      break;
    }
    if (chord.size >= 3) patterns.add([...chord].reduce((mask, lane) => mask | (1 << lane), 0));
  }
  const valid = (permutation: readonly number[]): boolean => {
    if (permutation.every((lane, index) => lane === 8 - index)) return false;
    for (const pattern of patterns) {
      let chord = 0;
      for (let lane = 0; lane < 9; lane += 1) if ((pattern & (1 << lane)) !== 0) chord |= 1 << permutation[lane]!;
      if (masks.some((mask) => (chord & mask) === mask)) return false;
    }
    return true;
  };
  const visit = (callback: (permutation: number[]) => boolean | void): void => {
    const permutation = Array.from({ length: 9 }, (_, index) => index);
    const counters = Array.from({ length: 9 }, () => 0);
    let index = 0;
    while (index < 9) {
      if (counters[index]! < index) {
        const other = index % 2 === 0 ? 0 : counters[index]!;
        [permutation[index], permutation[other]] = [permutation[other]!, permutation[index]!];
        if (callback(permutation) === true) return;
        counters[index]! += 1;
        index = 0;
      } else {
        counters[index] = 0;
        index += 1;
      }
    }
  };
  let count = 0;
  if (!impossible) visit((permutation) => void (valid(permutation) && (count += 1)));
  if (count === 0) return Array.from({ length: 9 }, (_, index) => (draw < 0.5 ? index : 8 - index));
  let remaining = Math.floor(draw * count);
  let selected: number[] = [];
  visit((permutation) => {
    if (!valid(permutation)) return;
    if (remaining-- === 0) {
      selected = [...permutation];
      return true;
    }
  });
  return selected;
}

test('picks the same permutation as the previous search on random charts', () => {
  let seed = 12345;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let chart = 0; chart < 12; chart += 1) {
    const notes: SRandomNote[] = [];
    const rows = 3 + Math.floor(next() * 12);
    for (let row = 0; row < rows; row += 1) {
      const size = 1 + Math.floor(next() * (chart % 4 === 3 ? 7 : 5));
      const picked = new Set<number>();
      while (picked.size < size) picked.add(Math.floor(next() * 9));
      for (const lane of picked) {
        const long = next() < 0.2;
        notes.push({ channel: lanes[lane]!, timeMs: row * 100, ...(long ? { endTimeMs: row * 100 + 250 } : {}) });
      }
    }
    for (const draw of [0, 0.37, 0.999]) {
      const expected = referencePermutation(notes, draw);
      const actual = randomizePMSPlayableLanes(notes, lanes, () => draw);
      expect(actual).toEqual(notes.map((note) => lanes[expected[lanes.indexOf(note.channel)]!]));
    }
  }
});
