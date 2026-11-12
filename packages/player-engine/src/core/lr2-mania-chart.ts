/**
 * The chart generators of LR2 beta3's hidden mania panel: ADD NOTES, LOUDNESS, ADD LONGNOTES and ADD MINES (OpenLR2
 * `LR2f.cpp` L26744-L26867, L27813-L27869). They rewrite a play's fresh notes and mines; the source chart stays as it
 * is. Every draw comes from the supplied source, so a recorded seed rebuilds the same chart.
 *
 * LR2 runs ADD NOTES and LOUDNESS on the time-sorted object list before its lane options, and ADD LONGNOTES and ADD
 * MINES on each lane's own list after them. Here all four run before the lane options, which then move what was added
 * with its lane; for the options that move whole lanes the result is the same.
 */
import {
  createBeatAtSecondsResolverFromTimingResolver,
  PLAY_MODE_LAYOUTS,
  type ResolvedChart,
} from '@be-music/chart-model';
import type { BeMusicEvent } from '@be-music/chart-source';
import { drawLaneRandomIndex, type LaneRandomSource } from '../lane-random-source.ts';
import type { TimedLandmineNote, TimedPlayableNote } from '../playable-notes.ts';
import { createLaneBindings, resolveLaneOptionChannels } from './lane-layout.ts';

/** Each generator's rate: 0 (off) or 10–100 in LR2's steps of 10. */
export interface LR2ManiaChartRates {
  addNotes?: number;
  loudness?: number;
  addLongNotes?: number;
  addMines?: number;
}

/** What each generator changed: notes added, chords filled, long notes made or lengthened, mines added. */
export interface LR2ManiaChartChanges {
  addNotes: number;
  loudness: number;
  addLongNotes: number;
  addMines: number;
}

/** The lanes of one play side as LR2 walks them: the scratch first (its lane 0), then the keys. */
export interface LR2ManiaSide {
  readonly scratch: string | undefined;
  readonly keys: readonly string[];
}

/** A rate on LR2's scale: a whole 0–100, anything else off. */
export function clampLR2ManiaRate(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.trunc(value))) : 0;
}

/** Whether any generator is on. */
export function hasLR2ManiaChart(rates: LR2ManiaChartRates | undefined): boolean {
  if (rates === undefined) return false;
  return (
    clampLR2ManiaRate(rates.addNotes) > 0 ||
    clampLR2ManiaRate(rates.loudness) > 0 ||
    clampLR2ManiaRate(rates.addLongNotes) > 0 ||
    clampLR2ManiaRate(rates.addMines) > 0
  );
}

/**
 * The play sides of a chart LR2 can load (5 / 7 / 9 / 10 / 14 KEY), or none for any other mode. A nine-key chart has
 * no scratch here: LR2's lane 0 is not one of its nine keys, and whether LR2 fills it there was not read.
 */
export function resolveLR2ManiaSides(resolved: ResolvedChart, chartExtension?: string): LR2ManiaSide[] {
  const variant = resolved.playVariant;
  if (variant !== '5' && variant !== '7' && variant !== '9' && variant !== '10' && variant !== '14') return [];
  const channels = [...resolved.notes, ...resolved.mines, ...resolved.invisibleNotes].map(({ channel }) => channel);
  const bindings = createLaneBindings(channels.length > 0 ? channels : ['11'], {
    player: resolved.source.bms.player,
    playVariant: variant,
    chartExtension,
  });
  return (['1P', '2P'] as const)
    .map((side) => ({
      scratch:
        variant === '9'
          ? undefined
          : PLAY_MODE_LAYOUTS[variant].lanes.find((lane) => lane.side === side && lane.kind === 'scratch')?.channel,
      keys: resolveLaneOptionChannels(side, variant, bindings),
    }))
    .filter((side) => side.keys.length > 0);
}

/** LR2's `GetRand(max)`: a whole number from 0 to `max`, both included. */
function getRand(max: number, random: LaneRandomSource): number {
  return drawLaneRandomIndex(max + 1, random);
}

/** LR2 gives a generated note keysound 1294, the `#WAV` slot `ZY`. */
const GENERATED_NOTE_VALUE = 'ZY';

/** What the row walk reads of a note or a mine. */
type RowObject = Pick<TimedPlayableNote, 'seconds' | 'beat' | 'event' | 'channel'>;

/** The objects that share a time, notes and mines alike, in time order. */
function collectRows(
  notes: readonly RowObject[],
  mines: readonly RowObject[],
): { seconds: number; beat: number; event: BeMusicEvent; channels: string[] }[] {
  const rows = new Map<number, { seconds: number; beat: number; event: BeMusicEvent; channels: string[] }>();
  for (const object of [...notes, ...mines]) {
    const key = Math.round(object.seconds * 1e6);
    const row = rows.get(key);
    if (row) row.channels.push(object.channel);
    else rows.set(key, { seconds: object.seconds, beat: object.beat, event: object.event, channels: [object.channel] });
  }
  return [...rows.values()].sort((left, right) => left.seconds - right.seconds);
}

function makeNote(row: { seconds: number; beat: number; event: BeMusicEvent }, channel: string): TimedPlayableNote {
  return {
    event: { measure: row.event.measure, position: [...row.event.position], channel, value: GENERATED_NOTE_VALUE },
    soundEvents: undefined,
    endSoundEvent: undefined,
    channel,
    beat: row.beat,
    endBeat: undefined,
    endSeconds: undefined,
    longNoteMode: undefined,
    generatedLongNote: undefined,
    visibleUntilBeat: undefined,
    seconds: row.seconds,
    judged: false,
    invisible: undefined,
  };
}

/** Both generators first turn every long note back into its head, as LR2 resets each object's end to its start. */
function collapseLongNotes(notes: TimedPlayableNote[]): void {
  for (const note of notes) {
    if (note.endSeconds === undefined) continue;
    // Assign rather than `delete`, which would drop the note into dictionary mode.
    note.endSeconds = undefined;
    note.endBeat = undefined;
    note.longNoteMode = undefined;
    note.visibleUntilBeat = undefined;
    note.generatedLongNote = undefined;
  }
}

function sortNotes(notes: TimedPlayableNote[]): void {
  notes.sort((left, right) => left.beat - right.beat || (left.channel < right.channel ? -1 : 1));
}

/**
 * ADD NOTES (`m_addnote`): at each time a side has notes or mines, one try per such object. A try passes when
 * `GetRand(100) <= rate`, and then puts a note on one of the side's lanes, scratch included, that holds nothing at
 * that time, picked evenly. Returns the notes added.
 */
export function addLR2Notes(
  notes: TimedPlayableNote[],
  mines: readonly RowObject[],
  sides: readonly LR2ManiaSide[],
  rate: number,
  random: LaneRandomSource,
): number {
  collapseLongNotes(notes);
  let added = 0;
  for (const row of collectRows(notes, mines)) {
    for (const side of sides) {
      const lanes = side.scratch === undefined ? [...side.keys] : [side.scratch, ...side.keys];
      const occupied = new Set(row.channels.filter((channel) => lanes.includes(channel)));
      const tries = row.channels.filter((channel) => lanes.includes(channel)).length;
      for (let attempt = 0; attempt < tries; attempt += 1) {
        if (getRand(100, random) > rate) continue;
        const empty = lanes.filter((lane) => !occupied.has(lane));
        if (empty.length === 0) continue;
        const lane = empty[getRand(empty.length - 1, random)]!;
        notes.push(makeNote(row, lane));
        occupied.add(lane);
        added += 1;
      }
    }
  }
  sortNotes(notes);
  return added;
}

/**
 * LOUDNESS (`m_loudness`): at each time a side has notes or mines, one draw; when `GetRand(100) <= rate`, every lane of
 * the side that holds nothing at that time, scratch included, gets a note. Returns the chords filled.
 */
export function applyLR2Loudness(
  notes: TimedPlayableNote[],
  mines: readonly RowObject[],
  sides: readonly LR2ManiaSide[],
  rate: number,
  random: LaneRandomSource,
): number {
  collapseLongNotes(notes);
  let filled = 0;
  for (const row of collectRows(notes, mines)) {
    for (const side of sides) {
      const lanes = side.scratch === undefined ? [...side.keys] : [side.scratch, ...side.keys];
      if (!row.channels.some((channel) => lanes.includes(channel))) continue;
      if (getRand(100, random) > rate) continue;
      const empty = lanes.filter((lane) => !row.channels.includes(lane));
      for (const lane of empty) notes.push(makeNote(row, lane));
      if (empty.length > 0) filled += 1;
    }
  }
  sortNotes(notes);
  return filled;
}

/** A key lane's notes and mines in time order, as LR2 keeps one list per lane. */
function laneObjects(
  lane: string,
  notes: readonly TimedPlayableNote[],
  mines: readonly TimedLandmineNote[],
): (TimedPlayableNote | TimedLandmineNote)[] {
  return [...notes.filter((note) => note.channel === lane), ...mines.filter((mine) => mine.channel === lane)].sort(
    (left, right) => left.seconds - right.seconds,
  );
}

function isMine(object: TimedPlayableNote | TimedLandmineNote): object is TimedLandmineNote {
  return 'mine' in object && object.mine === true;
}

/**
 * ADD LONGNOTES (`m_addlong`): on each key lane, one draw per object but the last. When `GetRand(100) < rate`, a note
 * is held until half-way to the lane's next object, unless it is already held longer. At 100 the lane's last note is
 * held to `endSeconds`, the end of the chart. Scratch lanes are left alone. Returns the notes made or lengthened.
 */
export function addLR2LongNotes(
  notes: TimedPlayableNote[],
  mines: readonly TimedLandmineNote[],
  sides: readonly LR2ManiaSide[],
  rate: number,
  random: LaneRandomSource,
  endSeconds: number,
  beatAtSeconds: (seconds: number) => number,
): number {
  let changed = 0;
  const hold = (note: TimedPlayableNote, until: number): void => {
    if (!(until > note.seconds) || (note.endSeconds ?? -Infinity) >= until) return;
    note.endSeconds = until;
    note.endBeat = beatAtSeconds(until);
    note.longNoteMode ??= 1;
    note.generatedLongNote = true;
    changed += 1;
  };
  for (const side of sides) {
    for (const lane of side.keys) {
      const objects = laneObjects(lane, notes, mines);
      for (let index = 0; index < objects.length - 1; index += 1) {
        if (getRand(100, random) >= rate) continue;
        const object = objects[index]!;
        if (!isMine(object)) hold(object, (object.seconds + objects[index + 1]!.seconds) / 2);
      }
      const last = objects.at(-1);
      if (rate === 100 && last !== undefined && !isMine(last)) hold(last, endSeconds);
    }
  }
  return changed;
}

/** LR2 measures ADD MINES in milliseconds: a gap must pass 200 ms, and an object that is not a long note ends at −1. */
const MINE_GAP_SECONDS = 0.2;
const NO_LONG_NOTE_END_SECONDS = -0.001;
/** LR2 gives an added mine the value 4 and no sound. */
const ADDED_MINE_VALUE = '04';

/**
 * ADD MINES (`m_addmine`): on each key lane, one draw per object but the last. When `GetRand(100) < rate` and the gap
 * to the next object is over 200 ms, a mine goes half-way between the two. The gap is measured from the object's own
 * time, unless the next object is a long note: then LR2 measures from this object's long-note end, which is −1 ms for
 * anything but a long note, so the mine lands at half the next object's time. Scratch lanes are left alone. Returns the
 * mines added.
 */
export function addLR2Mines(
  notes: readonly TimedPlayableNote[],
  mines: TimedLandmineNote[],
  sides: readonly LR2ManiaSide[],
  rate: number,
  random: LaneRandomSource,
  locate: (seconds: number) => { beat: number; measure: number; position: [number, number] },
): number {
  const added: TimedLandmineNote[] = [];
  for (const side of sides) {
    for (const lane of side.keys) {
      const objects = laneObjects(lane, notes, mines);
      for (let index = 0; index < objects.length - 1; index += 1) {
        if (getRand(100, random) >= rate) continue;
        const current = objects[index]!;
        const next = objects[index + 1]!;
        const nextIsLong = !isMine(next) && next.endSeconds !== undefined && next.endSeconds > next.seconds;
        const from = nextIsLong
          ? !isMine(current) && current.endSeconds !== undefined
            ? current.endSeconds
            : NO_LONG_NOTE_END_SECONDS
          : current.seconds;
        if (!(next.seconds - from > MINE_GAP_SECONDS)) continue;
        const seconds = (next.seconds + from) / 2;
        const place = locate(seconds);
        added.push({
          event: {
            measure: place.measure,
            position: place.position,
            channel: `${lane[0] === '1' ? 'D' : 'E'}${lane[1]}`,
            value: ADDED_MINE_VALUE,
          },
          channel: lane,
          beat: place.beat,
          seconds,
          judged: false,
          mine: true,
          silent: true,
        });
      }
    }
  }
  mines.push(...added);
  mines.sort((left, right) => left.beat - right.beat || (left.channel < right.channel ? -1 : 1));
  return added.length;
}

/**
 * Where a time falls in the chart: its beat, and its measure and place in it, for an object LR2 puts between the
 * chart's own.
 */
export function createLR2ManiaLocator(
  resolved: ResolvedChart,
): (seconds: number) => { beat: number; measure: number; position: [number, number] } {
  const beatAtSeconds = createBeatAtSecondsResolverFromTimingResolver(resolved.timing);
  const POSITION_STEPS = 1_000_000;
  return (seconds) => {
    const beat = beatAtSeconds(Math.max(0, seconds));
    let measure = 0;
    while (measure < 4999 && resolved.beatResolver.measureToBeat(measure + 1, 0) <= beat) measure += 1;
    const start = resolved.beatResolver.measureToBeat(measure, 0);
    const length = resolved.beatResolver.measureToBeat(measure + 1, 0) - start;
    const fraction = length > 0 ? Math.min(1 - 1 / POSITION_STEPS, Math.max(0, (beat - start) / length)) : 0;
    return { beat, measure, position: [Math.round(fraction * POSITION_STEPS), POSITION_STEPS] };
  };
}

/** The end of the chart as LR2 holds a last note to it: two seconds after the last note, or the last sound if later. */
export function resolveLR2ManiaEndSeconds(resolved: ResolvedChart, notes: readonly TimedPlayableNote[]): number {
  let end = resolved.sampleTriggers.at(-1)?.seconds ?? 0;
  for (const note of notes) end = Math.max(end, (note.endSeconds ?? note.seconds) + 2);
  return end;
}
