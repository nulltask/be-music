import type { SRandomNote } from './lane-random.ts';
import { drawLaneRandomIndex } from './lane-random-source.ts';

export interface LR2DoubleRandomOptions {
  scratch: string;
  flipped?: boolean;
  /** Non-lane objects present in the reference's sort input. */
  objects?: readonly LR2SortObject[];
}

export interface LR2SortObject {
  timeMs: number;
  order?: number;
  op: number;
}

/** LR2 beta3's CRT qsort at 0x717f80. Equal elements can move even in the short sort. */
export function sortLR2Objects<T>(items: T[], compare: (a: T, b: T) => number): void {
  const swap = (a: number, b: number) => {
    [items[a], items[b]] = [items[b]!, items[a]!];
  };
  const cmp = (a: number, b: number) => compare(items[a]!, items[b]!);
  const ranges: Array<[number, number]> = [[0, items.length - 1]];
  while (ranges.length) {
    const [start, end] = ranges.pop()!;
    const size = end - start + 1;
    if (size <= 8) {
      for (let last = end; last > start; last--) {
        let max = start;
        for (let i = start + 1; i <= last; i++) if (cmp(i, max) > 0) max = i;
        swap(max, last);
      }
      continue;
    }
    let pivot = start + Math.floor(size / 2);
    if (cmp(start, pivot) > 0) swap(start, pivot);
    if (cmp(start, end) > 0) swap(start, end);
    if (cmp(pivot, end) > 0) swap(pivot, end);

    let left = start;
    let right = end;
    for (;;) {
      if (left < pivot) while (++left < pivot && cmp(left, pivot) <= 0) {}
      if (left >= pivot) while (++left <= end && cmp(left, pivot) <= 0) {}
      while (--right > pivot && cmp(right, pivot) > 0) {}
      if (left > right) break;
      swap(left, right);
      if (right === pivot) pivot = left;
    }
    right++;
    while (--right > pivot && cmp(right, pivot) === 0) {}
    if (right <= pivot) while (--right > start && cmp(right, pivot) === 0) {}
    if (start < right) ranges.push([start, right]);
    if (left < end) ranges.push([left, end]);
  }
}

function laneOp(channel: string, flipped: boolean): number {
  const side = (channel[0] === '2') !== flipped ? 20 : 10;
  const lane = '61234589'.indexOf(channel[1] ?? '');
  return side + lane;
}

/** Placement runs over the entire sorted object stream, even when only one side is being modified. */
export function randomizeLR2DoubleNotes(
  notes: readonly SRandomNote[],
  lanes: readonly string[],
  options: LR2DoubleRandomOptions & { random: () => number; target?: string },
): string[] {
  const channels = notes.map(({ channel }) => channel);
  const { scratch, target, random, flipped = false } = options;
  const right = scratch === '26';
  const domain = new Set(lanes);
  const far = right ? lanes.slice(0, 4) : lanes.slice(3);
  const objects: Array<LR2SortObject & { index?: number }> = [...(options.objects ?? [])];
  notes.forEach((note, index) => {
    const op = laneOp(note.sourceChannel ?? note.channel, flipped);
    const offset = note.kind === 'invisible' ? 20 : note.kind === 'mine' ? 120 : (note.lr2OpOffset ?? 0);
    objects.push({ timeMs: note.timeMs, order: note.beat, op: op + offset, index });
    if (note.endTimeMs !== undefined && note.lr2SyntheticTail !== true)
      objects.push({ timeMs: note.endTimeMs, order: note.endBeat, op: op + (note.lr2OpOffset ?? 0) });
  });
  objects.sort((a, b) => (a.order ?? a.timeMs) - (b.order ?? b.timeMs) || a.op - b.op);
  sortLR2Objects(objects, (a, b) => Math.trunc(a.timeMs - b.timeMs));

  const marked = new Set<string>();
  const occupied = new Map<string, { start: number; end: number }>();
  let lastReset = Number.NEGATIVE_INFINITY;
  for (const { index, timeMs } of objects) {
    if (index === undefined) continue;
    const note = notes[index]!;
    const { channel } = note;
    if (note.kind === 'invisible') continue;

    // The source resets a side's marks before DP FLIP and marks the destination side after it.
    const originalSide = (note.sourceChannel ?? channel)[0];
    if ((originalSide === scratch[0]) !== flipped && lastReset < timeMs) {
      marked.clear();
      lastReset = timeMs;
    }
    if (channel !== scratch && !domain.has(channel)) continue;
    const canPlace = (lane: string): boolean => {
      const prior = occupied.get(lane);
      return prior === undefined || (prior.start !== timeMs && prior.end < timeMs);
    };
    let destination = channel;
    if (channel !== scratch) {
      const allMarked = lanes.every((lane) => marked.has(lane));
      const accepted = (lane: string) => canPlace(lane) && (allMarked || !marked.has(lane));
      if (!(target !== undefined && accepted(target)) && !lanes.some(accepted))
        throw new RangeError('LR2 14 KEY lane randomization has no acceptable destination.');
      // The reference draws before overriding the first candidate with the CONVERGE target.
      for (let attempt = 0; ; attempt++) {
        const draw = lanes[drawLaneRandomIndex(lanes.length, random)]!;
        destination = attempt === 0 && target !== undefined ? target : draw;
        if (accepted(destination)) break;
        if (attempt === 1023) throw new RangeError('LR2 14 KEY lane randomization exceeded its retry limit.');
      }
      marked.add(destination);
      channels[index] = destination;
    }
    if (destination === scratch) for (const lane of far) marked.add(lane);
    occupied.set(destination, { start: timeMs, end: note.endTimeMs ?? timeMs });
  }

  return channels;
}
