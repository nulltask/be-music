import type { ChartPlayVariant } from '@be-music/chart-model';
import type { TimedPlayableNote } from '../playable-notes.ts';

/**
 * nanasigroove 1.552's NOTES DOUBLE (`774:NOTES_DOUBLE`, #1184), the reading of a version 3 chart gameplay program
 * (docs/adr/0035-chart-authored-notes-options.md).
 *
 * DOUBLE copies whole lanes into other lanes, one copy after another, each copy taking the source lane as it stands (so a
 * lane that has already received a copy passes it on). On 5 KEY the copies are 1→3, 2→4, 3→5, 4→2 and 5→3: keys 3 and 5
 * end up with keys 1, 3 and 5, and keys 2 and 4 with keys 2 and 4. The scratch and FREE ZONE are left alone, and
 * invisible objects travel with their lane; mines do not.
 *
 * Each lane then keeps one object at each instant, preferring in turn the lane's own long note, the lane's own key note,
 * a long note from the same side, a key note from the same side, and otherwise whichever arrived first (the lane's own
 * objects before the copies, the copies in the order they were made). Be-Music keeps two narrow rules of its own:
 *
 * - The chart's own objects always stay (an instant the chart already doubles is the chart's, not DOUBLE's).
 * - A long-note copy stays only when both its ends stay, and a key-note copy is dropped where it would overlap a long
 *   note on its lane: a Be-Music lane plays one object at a time.
 */

/** The lane copies DOUBLE makes, in order, per play variant nanasigroove defines them for. */
const DOUBLE_COPIES: Partial<Record<ChartPlayVariant, ReadonlyArray<readonly [string, string]>>> = (() => {
  const fiveKey = [
    ['11', '13'],
    ['12', '14'],
    ['13', '15'],
    ['14', '12'],
    ['15', '13'],
  ] as const;
  const sevenKey = [
    ['11', '13'],
    ['12', '14'],
    ['13', '15'],
    ['14', '12'],
    ['15', '19'],
    ['18', '14'],
    ['19', '15'],
  ] as const;
  return {
    '5': fiveKey,
    '7': sevenKey,
    '9': [
      ['11', '13'],
      ['12', '14'],
      ['13', '15'],
      ['14', '12'],
      ['15', '23'],
      ['22', '14'],
      ['23', '25'],
      ['24', '22'],
      ['25', '23'],
    ],
    '10': [...fiveKey, ['21', '23'], ['22', '24'], ['23', '25'], ['24', '22'], ['25', '23']],
    '14': [
      ...sevenKey,
      ['21', '23'],
      ['22', '24'],
      ['23', '25'],
      ['24', '22'],
      ['25', '29'],
      ['28', '24'],
      ['29', '25'],
    ],
  };
})();

/** Whether nanasigroove's DOUBLE is defined for `playVariant`. */
export function nanasiDoubleSupports(playVariant: ChartPlayVariant): boolean {
  return DOUBLE_COPIES[playVariant] !== undefined;
}

/** One object in a lane's list: the chart object it copies and the lane that object belongs to. */
interface LaneEntry {
  source: TimedPlayableNote;
  origin: string;
}

/** Whole microseconds, the unit replays and lane options group objects by. */
function toMicroseconds(seconds: number): number {
  return Math.round(seconds * 1_000_000);
}

function isLongNote(note: TimedPlayableNote): boolean {
  return note.invisible !== true && note.endSeconds !== undefined;
}

/** A copied event's channel: the source event's kind (visible, invisible or long note) on `lane` (`1x` / `2x`). */
function eventChannelOnLane(sourceChannel: string, lane: string): string {
  const kind = sourceChannel[0];
  const twoP = lane[0] === '2';
  const prefix =
    kind === '3' || kind === '4' ? (twoP ? '4' : '3') : kind === '5' || kind === '6' ? (twoP ? '6' : '5') : lane[0]!;
  return `${prefix}${lane.slice(1)}`;
}

/**
 * The class an entry takes on `lane` at one instant: lower wins. The lane's own long note, its own key note, a same-side
 * long note, a same-side key note, then anything else.
 */
function entryClass(entry: LaneEntry, lane: string): number {
  const longNote = isLongNote(entry.source);
  const visible = entry.source.invisible !== true;
  if (entry.origin === lane) return longNote ? 0 : visible ? 1 : 4;
  if (entry.origin[0] !== lane[0] || !visible) return 4;
  return longNote ? 2 : 3;
}

/**
 * DOUBLE in place on `notes` and `invisible`: adds the copies that stay (new objects with their own event identity on
 * their lane, so a replay tells them apart, with the source's keysound and timing and no long-note modifier mark).
 * Returns the number of objects added; `0` where nanasigroove defines no DOUBLE for the variant.
 */
export function doubleNanasiChartNotes(
  notes: TimedPlayableNote[],
  invisible: TimedPlayableNote[],
  playVariant: ChartPlayVariant,
): number {
  const copies = DOUBLE_COPIES[playVariant];
  if (copies === undefined) return 0;
  const lanes = new Set(copies.flat());
  const lists = new Map<string, LaneEntry[]>();
  const owned = new Map<string, number>();
  for (const lane of lanes) lists.set(lane, []);
  for (const source of [...notes, ...invisible].sort((a, b) => a.seconds - b.seconds))
    lists.get(source.channel)?.push({ source, origin: source.channel });
  for (const lane of lanes) owned.set(lane, lists.get(lane)!.length);
  for (const [from, to] of copies) lists.get(to)!.push(...lists.get(from)!.slice());

  const addedNotes: TimedPlayableNote[] = [];
  const addedInvisible: TimedPlayableNote[] = [];
  for (const lane of lanes) {
    const list = lists.get(lane)!;
    const ownCount = owned.get(lane)!;
    if (list.length === ownCount) continue;
    // The winner at each instant (µs): the lowest class, then the earliest in the list.
    const winners = new Map<number, { index: number; rank: number }>();
    const contend = (time: number, index: number, rank: number): void => {
      const current = winners.get(time);
      if (current === undefined || rank < current.rank || (rank === current.rank && index < current.index))
        winners.set(time, { index, rank });
    };
    list.forEach((entry, index) => {
      const rank = entryClass(entry, lane);
      contend(toMicroseconds(entry.source.seconds), index, rank);
      if (isLongNote(entry.source)) contend(toMicroseconds(entry.source.endSeconds!), index, rank);
    });
    const wins = (time: number, index: number): boolean => winners.get(time)?.index === index;
    // Spans the lane's visible objects hold (µs, inclusive); a key note is a point.
    const spans: Array<[number, number]> = [];
    const spanOf = (note: TimedPlayableNote): [number, number] => {
      const start = toMicroseconds(note.seconds);
      return [start, isLongNote(note) ? Math.max(start, toMicroseconds(note.endSeconds!)) : start];
    };
    for (let index = 0; index < ownCount; index++) {
      const source = list[index]!.source;
      if (source.invisible !== true) spans.push(spanOf(source));
    }
    for (let index = ownCount; index < list.length; index++) {
      const { source } = list[index]!;
      if (!wins(toMicroseconds(source.seconds), index)) continue;
      if (isLongNote(source) && !wins(toMicroseconds(source.endSeconds!), index)) continue;
      if (source.invisible !== true) {
        const [start, end] = spanOf(source);
        if (spans.some(([from, to]) => from <= end && start <= to)) continue;
        spans.push([start, end]);
      }
      // Overriding in a spread keeps the field order (one hidden class for every play note).
      const copy: TimedPlayableNote = {
        ...source,
        generatedLongNote: undefined,
        channel: lane,
        judged: false,
        event: {
          ...source.event,
          position: [...source.event.position] as [number, number],
          channel: eventChannelOnLane(source.event.channel, lane),
        },
      };
      (source.invisible === true ? addedInvisible : addedNotes).push(copy);
    }
  }
  const order = (a: TimedPlayableNote, b: TimedPlayableNote): number =>
    a.seconds - b.seconds || a.channel.localeCompare(b.channel);
  if (addedNotes.length > 0) {
    notes.push(...addedNotes);
    notes.sort(order);
  }
  if (addedInvisible.length > 0) {
    invisible.push(...addedInvisible);
    invisible.sort(order);
  }
  return addedNotes.length + addedInvisible.length;
}
