import type { SRandomNote } from './lane-random.ts';

// beatoraja 0.8.9 LanePlayableRandomShuffleModifier's ten impossible three-key chords.
const IMPOSSIBLE_CHORDS = [
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
].map((chord) => chord.reduce((mask, lane) => mask | (1 << lane), 0));

/**
 * beatoraja PMS RANDOM_PLAYABLE: choose uniformly among chart-wide permutations
 * without the source's impossible chords, excluding regular and mirror. Seven-
 * key chords, or no valid permutation, fall back to regular/mirror at random.
 * LN tails release before evaluating their timeline, matching the source search.
 */
export function randomizePMSPlayableLanes(
  notes: readonly SRandomNote[],
  lanes: readonly string[],
  random: () => number,
): string[] {
  if (lanes.length !== 9 || new Set(lanes).size !== 9) throw new RangeError('PMS playable RANDOM requires nine lanes.');
  const indexByLane = new Map(lanes.map((lane, index) => [lane, index]));
  const rows = new Map<number, number[]>();
  notes.forEach((note, index) => {
    if (!indexByLane.has(note.channel) || (note.kind ?? 'note') !== 'note') return;
    const row = rows.get(note.timeMs);
    if (row) row.push(index);
    else rows.set(note.timeMs, [index]);
    if (note.endTimeMs !== undefined && note.endTimeMs > note.timeMs && !rows.has(note.endTimeMs))
      rows.set(note.endTimeMs, []);
  });
  const patterns = new Set<number>();
  const held = new Map<number, number>();
  let impossible = false;
  for (const [timeMs, indices] of [...rows].sort(([a], [b]) => a - b)) {
    for (const [lane, endMs] of held) if (endMs <= timeMs) held.delete(lane);
    const chord = new Set(held.keys());
    for (const index of indices) {
      const note = notes[index]!;
      const lane = indexByLane.get(note.channel)!;
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
      if (IMPOSSIBLE_CHORDS.some((forbidden) => (chord & forbidden) === forbidden)) return false;
    }
    return true;
  };
  let count = 0;
  if (!impossible)
    visitPermutations((permutation) => {
      if (valid(permutation)) count += 1;
    });
  const draw = random();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new RangeError('Lane randomness must be in [0, 1).');
  let permutation: readonly number[];
  if (count === 0) permutation = Array.from({ length: 9 }, (_, index) => (draw < 0.5 ? index : 8 - index));
  else {
    let remaining = Math.floor(draw * count);
    let selected: number[] | undefined;
    visitPermutations((candidate) => {
      if (!valid(candidate)) return;
      if (remaining-- === 0) {
        selected = [...candidate];
        return true;
      }
    });
    permutation = selected!;
  }
  return notes.map((note) => {
    const source = indexByLane.get(note.channel);
    return source === undefined ? note.channel : lanes[permutation[source]!]!;
  });
}

/** Heap's algorithm in the source order, omitting the initial regular permutation. */
function visitPermutations(visit: (permutation: readonly number[]) => boolean | void): void {
  const permutation = Array.from({ length: 9 }, (_, index) => index);
  const counters = Array.from({ length: 9 }, () => 0);
  let index = 0;
  while (index < 9) {
    if (counters[index]! < index) {
      const other = index % 2 === 0 ? 0 : counters[index]!;
      [permutation[index], permutation[other]] = [permutation[other]!, permutation[index]!];
      if (visit(permutation) === true) return;
      counters[index]! += 1;
      index = 0;
    } else {
      counters[index] = 0;
      index += 1;
    }
  }
}
