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

/** Whether each nine-lane mask of exactly three lanes is one of {@link IMPOSSIBLE_CHORDS}. */
const IMPOSSIBLE_TRIPLE = new Uint8Array(512);
for (const chord of IMPOSSIBLE_CHORDS) IMPOSSIBLE_TRIPLE[chord] = 1;

/**
 * The three-lane subsets of `pattern`, as `[a, b, c]` lane triples. Every impossible chord has three lanes and a
 * permutation is a bijection, so a chord's image contains an impossible chord exactly when one of its three-lane
 * subsets maps onto it: checking the subsets is the source's superset test, without building each chord's image.
 */
export function chordTriples(pattern: number): number[][] {
  const lanes: number[] = [];
  for (let lane = 0; lane < 9; lane += 1) if ((pattern & (1 << lane)) !== 0) lanes.push(lane);
  const triples: number[][] = [];
  for (let a = 0; a < lanes.length; a += 1)
    for (let b = a + 1; b < lanes.length; b += 1)
      for (let c = b + 1; c < lanes.length; c += 1) triples.push([lanes[a]!, lanes[b]!, lanes[c]!]);
  return triples;
}

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
  // Each pattern as its distinct three-lane subsets, flattened to `a, b, c, a, b, c, …` (see `chordTriples`).
  const tripleMasks = new Set<number>();
  for (const pattern of patterns)
    for (const [a, b, c] of chordTriples(pattern)) tripleMasks.add((1 << a!) | (1 << b!) | (1 << c!));
  const triples = new Uint8Array(tripleMasks.size * 3);
  let offset = 0;
  for (const mask of tripleMasks)
    for (let lane = 0; lane < 9; lane += 1) if ((mask & (1 << lane)) !== 0) triples[offset++] = lane;
  // The visit ordinals of the valid permutations, in the source order; a uniform pick among them is the source's pick.
  const validCount = impossible ? 0 : searchValidOrdinals(triples);
  const draw = random();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new RangeError('Lane randomness must be in [0, 1).');
  const permutation =
    validCount === 0
      ? Array.from({ length: 9 }, (_, index) => (draw < 0.5 ? index : 8 - index))
      : permutationAt(VALID_ORDINALS[Math.floor(draw * validCount)]!);
  return notes.map((note) => {
    const source = indexByLane.get(note.channel);
    return source === undefined ? note.channel : lanes[permutation[source]!]!;
  });
}

/** The number of permutations Heap's algorithm visits after the initial regular one. */
const VISITED_PERMUTATIONS = 362_879;

/**
 * Heap's algorithm in the source order, as its swaps: visit `k` (0 = the first after the regular permutation) swaps
 * positions `HEAP_SWAPS[2k]` and `HEAP_SWAPS[2k + 1]`. Built on first use; with it the search runs one straight loop
 * instead of Heap's counter bookkeeping.
 */
let HEAP_SWAPS: Uint8Array | undefined;
/** The visit ordinal of the mirror permutation, which the source never picks. */
let MIRROR_ORDINAL = -1;

function heapSwaps(): Uint8Array {
  if (HEAP_SWAPS) return HEAP_SWAPS;
  const swaps = new Uint8Array(VISITED_PERMUTATIONS * 2);
  const permutation = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const counters = new Uint8Array(9);
  let ordinal = 0;
  let index = 0;
  while (index < 9) {
    if (counters[index]! < index) {
      const other = index % 2 === 0 ? 0 : counters[index]!;
      const swap = permutation[index]!;
      permutation[index] = permutation[other]!;
      permutation[other] = swap;
      swaps[ordinal * 2] = index;
      swaps[ordinal * 2 + 1] = other;
      if (permutation.every((lane, at) => lane === 8 - at)) MIRROR_ORDINAL = ordinal;
      ordinal += 1;
      counters[index]! += 1;
      index = 0;
    } else {
      counters[index] = 0;
      index += 1;
    }
  }
  HEAP_SWAPS = swaps;
  return swaps;
}

/** The ordinals {@link searchValidOrdinals} found, reused across calls (only its returned prefix is meaningful). */
const VALID_ORDINALS = new Uint32Array(VISITED_PERMUTATIONS);

/**
 * Heap's algorithm in the source order (omitting the initial regular permutation), writing into
 * {@link VALID_ORDINALS} the ordinal of each permutation that is not the mirror and maps none of `triples`
 * (`a, b, c, …`) onto an impossible chord. Returns how many it wrote.
 */
function searchValidOrdinals(triples: Uint8Array): number {
  const swaps = heapSwaps();
  const permutation = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const ordinals = VALID_ORDINALS;
  const tripleLength = triples.length;
  let found = 0;
  for (let ordinal = 0; ordinal < VISITED_PERMUTATIONS; ordinal += 1) {
    const index = swaps[ordinal * 2]!;
    const other = swaps[ordinal * 2 + 1]!;
    const swap = permutation[index]!;
    permutation[index] = permutation[other]!;
    permutation[other] = swap;
    if (ordinal === MIRROR_ORDINAL) continue;
    let valid = true;
    for (let at = 0; at < tripleLength; at += 3) {
      const image =
        (1 << permutation[triples[at]!]!) |
        (1 << permutation[triples[at + 1]!]!) |
        (1 << permutation[triples[at + 2]!]!);
      if (IMPOSSIBLE_TRIPLE[image] === 1) {
        valid = false;
        break;
      }
    }
    if (valid) ordinals[found++] = ordinal;
  }
  return found;
}

/** The permutation Heap's algorithm visits at `target` (0 = the first after the regular one). */
function permutationAt(target: number): number[] {
  if (target < 0 || target >= VISITED_PERMUTATIONS) throw new RangeError(`No permutation at ${target}.`);
  const swaps = heapSwaps();
  const permutation = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  for (let ordinal = 0; ordinal <= target; ordinal += 1) {
    const index = swaps[ordinal * 2]!;
    const other = swaps[ordinal * 2 + 1]!;
    const swap = permutation[index]!;
    permutation[index] = permutation[other]!;
    permutation[other] = swap;
  }
  return permutation;
}
