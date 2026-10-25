import { drawLaneRandomIndex } from './lane-random-source.ts';
import type { SRandomNote } from './lane-random.ts';

/**
 * LR2 beta3 SCATTER. Previous-row destinations and active LN tails are distinct constraints:
 * repeat a previous-row destination only when the whole avoidance mask is exhausted.
 * Scratch-only rows advance the mask; hidden notes and LN tails alone do not.
 * Original LR2body.exe 100201, 0x4b4a60..0x4b4e0f (OpenLR2 583a3850 L27270-L27404).
 * Inputs already carry DP FLIP; source row bookkeeping happens before that flip.
 */
export function randomizeLR2ScatterNotes(
  notes: readonly SRandomNote[],
  lanes: readonly string[],
  options: {
    random: () => number;
    side?: '1P' | '2P';
    scratch?: string;
    doublePlay?: boolean;
    flipped?: boolean;
    correctedNineKey?: boolean;
  },
): string[] {
  if (![5, 7, 9].includes(lanes.length) || new Set(lanes).size !== lanes.length)
    throw new RangeError('LR2 SCATTER requires a complete five-, seven- or nine-key domain.');
  const nineKey = lanes.length === 9;
  // The original inclusive GetRand(9) reaches raw lane 10 (2P scratch), outside the PMS playfield.
  const outside = nineKey && !options.correctedNineKey ? '26' : undefined;
  const destinations = outside ? [...lanes, outside] : lanes;
  const side = options.side ?? (lanes[0]!.startsWith('2') ? '2P' : '1P');
  const sideDigit = side === '1P' ? '1' : '2';
  const scratch = options.scratch ?? (side === '1P' ? '16' : '26');
  const domain = new Set(lanes);
  const channels = notes.map((note) => note.channel);
  const occupied = new Set<string>();
  const lastEnd = new Map<string, number>();
  let previous = new Set<string>();
  let lastRow = 0;
  // PMS keys 6..9 use normalized 2P channels, but all nine belong to LR2's first side.
  const sourceSide = (channel: string): string =>
    nineKey ? '1' : options.flipped ? (channel[0] === '1' ? '2' : '1') : channel[0]!;
  const laneOrder = (channel: string): number => {
    if (nineKey) return lanes.indexOf(channel) + 1;
    const key = channel[1]!;
    return Number(sourceSide(channel)) * 10 + (key === '6' ? 0 : key === '8' ? 6 : key === '9' ? 7 : Number(key));
  };
  const indices = notes
    .map((_, index) => index)
    .filter(
      (index) =>
        notes[index]!.kind !== 'invisible' &&
        (nineKey ? domain.has(notes[index]!.channel) : /^[12][1-689]$/.test(notes[index]!.channel)),
    )
    .sort((a, b) => notes[a]!.timeMs - notes[b]!.timeMs || laneOrder(notes[a]!.channel) - laneOrder(notes[b]!.channel));
  for (const index of indices) {
    const note = notes[index]!;
    if (sourceSide(note.channel) === sideDigit && note.timeMs > lastRow) {
      lastRow = note.timeMs;
      previous = new Set(occupied);
      for (const lane of occupied)
        if (lane !== outside && (lastEnd.get(lane) ?? -Infinity) < note.timeMs) occupied.delete(lane);
    }
    if (!nineKey && !note.channel.startsWith(sideDigit)) continue;
    let target = note.channel;
    if (domain.has(note.channel)) {
      const free = destinations.filter((lane) => !lastEnd.has(lane) || lastEnd.get(lane)! < note.timeMs);
      const preferred = free.filter((lane) => !previous.has(lane));
      if (free.length === 0 || (preferred.length === 0 && destinations.some((lane) => !previous.has(lane))))
        throw new RangeError('LR2 SCATTER has no placement satisfying the source row and LN constraints.');
      const candidates = preferred.length > 0 ? preferred : free;
      target = candidates[drawLaneRandomIndex(candidates.length, options.random)]!;
      previous.add(target);
      channels[index] = target;
    } else if (note.channel !== scratch) continue;
    occupied.add(target);
    lastEnd.set(target, Math.max(note.timeMs, note.endTimeMs ?? note.timeMs));
    // The source's 14KEY scratch masks are applied before subsequent keys in this row.
    if (options.doublePlay && lanes.length === 7 && target === scratch) {
      for (const lane of side === '1P' ? lanes.slice(3) : lanes.slice(0, 4)) previous.add(lane);
    }
  }
  return channels;
}
