import { normalizeChannel, type BeMusicEvent } from '@be-music/chart-source';
import { PLAY_MODE_LAYOUTS, type ResolvedChart } from '@be-music/chart-model';
import { createLaneBindings, resolveLaneOptionChannels } from './lane-layout.ts';
import { toTimedLandmineNote, type TimedLandmineNote, type TimedPlayableNote } from '../playable-notes.ts';

export type MineModifier = 'OFF' | 'REMOVE' | 'ADD_RANDOM';

/** Effective mine placements from a replay; random generation is bypassed when these are supplied. */
export interface MinePlacement {
  channel: string;
  timeUs: number;
  damage?: number;
  silent?: boolean;
}

interface Timeline {
  beat: number;
  event: Pick<BeMusicEvent, 'measure' | 'position'>;
}

/**
 * beatoraja 0.8.9 MineNoteModifier. Generation visits every decoder timeline in
 * source lane order, including empty measure starts, and reserves LN tails.
 * Its ADD_RANDOM uses an independent unseeded draw per blank cell (> 0.9).
 * The caller supplies that randomness; a replay supplies effective placements.
 */
export function prepareMineModifier(
  resolved: ResolvedChart,
  mode: MineModifier,
  options: {
    laneModeExtension?: string;
    notes?: readonly TimedPlayableNote[];
    random?: () => number;
    placements?: readonly MinePlacement[];
  } = {},
): { mines: TimedLandmineNote[]; changes: number } {
  const original = resolved.mines.map(toTimedLandmineNote);
  if (mode === 'OFF') return { mines: original, changes: 0 };
  if (mode === 'REMOVE') return { mines: [], changes: original.length };
  const notes = options.notes ?? resolved.notes.map((note) => ({ ...note, judged: false }));
  const lanes = sourceLanes(resolved, options.laneModeExtension);
  const timelines = collectTimelines(resolved, lanes);
  if (options.placements !== undefined) {
    if (options.placements.length < original.length)
      throw new RangeError('Recorded added-mine population is missing authored mines.');
    const rows = new Map(timelines.map((row) => [Math.round(resolved.timing.beatToSeconds(row.beat) * 1e6), row]));
    const mines = options.placements.map((placement) => {
      const row = rows.get(placement.timeUs);
      if (!row) throw new RangeError('Recorded mine is not on a source timeline.');
      if (!/^[12][0-9A-Z]$/.test(placement.channel)) throw new RangeError('Invalid recorded mine lane.');
      const damage = placement.damage ?? 4;
      if (!Number.isFinite(damage) || damage < 0) throw new RangeError('Invalid recorded mine damage.');
      return makeMine(row, placement.channel, placement.timeUs / 1e6, damage, placement.silent === true);
    });
    return { mines, changes: Math.max(0, mines.length - original.length) };
  }
  if (!options.random) throw new RangeError('Mine ADD RANDOM requires supplied randomness or recorded placements.');
  const scoring = new Map<number, (typeof notes)[number][]>();
  for (const note of notes) {
    const row = scoring.get(note.beat);
    if (row) row.push(note);
    else scoring.set(note.beat, [note]);
  }
  const existing = new Map<number, Set<string>>();
  for (const mine of original) {
    const row = existing.get(mine.beat) ?? new Set<string>();
    row.add(mine.channel);
    existing.set(mine.beat, row);
  }
  const held = new Map<string, number>();
  const mines = [...original];
  for (const row of timelines) {
    for (const [lane, end] of held) if (end < row.beat) held.delete(lane);
    const occupied = new Set(existing.get(row.beat));
    for (const note of scoring.get(row.beat) ?? []) {
      occupied.add(note.channel);
      if (note.endBeat !== undefined && note.endBeat > row.beat) held.set(note.channel, note.endBeat);
    }
    for (const lane of lanes) {
      if (occupied.has(lane) || held.has(lane)) continue;
      const draw = options.random();
      if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new RangeError('Mine randomness must be in [0, 1).');
      if (draw > 0.9) mines.push(makeMine(row, lane, resolved.timing.beatToSeconds(row.beat), 10, true));
    }
  }
  mines.sort((a, b) => a.beat - b.beat || lanes.indexOf(a.channel) - lanes.indexOf(b.channel));
  return { mines, changes: mines.length - original.length };
}

function sourceLanes(resolved: ResolvedChart, chartExtension?: string): string[] {
  const channels = [...resolved.notes, ...resolved.mines, ...resolved.invisibleNotes].map(({ channel }) => channel);
  const bindings = createLaneBindings(channels.length > 0 ? channels : ['11'], {
    player: resolved.source.bms.player,
    playVariant: resolved.playVariant,
    chartExtension,
  });
  return (['1P', '2P'] as const).flatMap((side) => {
    const keys = resolveLaneOptionChannels(side, resolved.playVariant, bindings);
    const extra =
      resolved.playVariant === '9'
        ? []
        : PLAY_MODE_LAYOUTS[resolved.playVariant].lanes
            .filter((lane) => lane.side === side && lane.kind !== 'key')
            .sort((a, b) => a.slot - b.slot)
            .map((lane) => lane.channel);
    return [...keys, ...extra];
  });
}

function collectTimelines(resolved: ResolvedChart, lanes: readonly string[]): Timeline[] {
  const rows = new Map<number, Timeline>();
  const add = (beat: number, event: Timeline['event']): void => {
    if (Number.isFinite(beat) && !rows.has(beat)) rows.set(beat, { beat, event });
  };
  let maxMeasure = 0;
  for (const event of resolved.sortedEvents) maxMeasure = Math.max(maxMeasure, event.measure);
  for (const measure of resolved.source.measures) maxMeasure = Math.max(maxMeasure, measure.index);
  // BMS Section creates a timeline at every measure start, even for empty sections.
  if (resolved.sourceFormat === 'bms')
    for (let measure = 0; measure <= maxMeasure; measure += 1)
      add(resolved.beatResolver.measureToBeat(measure), { measure, position: [0, 1] });
  else for (const beat of resolved.barLines) add(beat, eventAtBeat(resolved, beat, maxMeasure));
  add(0, { measure: 0, position: [0, 1] });
  for (const event of resolved.sortedEvents) {
    const channel = normalizeChannel(event.channel);
    const family = channel[0]!;
    const lane = `${'135D'.includes(family) ? '1' : '2'}${channel[1] ?? ''}`;
    const laneEvent = ['1', '2', '3', '4', '5', '6', 'D', 'E'].includes(family) && lanes.includes(lane);
    if (laneEvent || ['01', '03', '04', '07', '08', '09', 'SC', 'SP'].includes(channel))
      add(resolved.beatResolver.eventToBeat(event), event);
  }
  // The normalized bmson notes carry their tails as lengths instead of raw events.
  for (const note of [...resolved.notes, ...resolved.mines, ...resolved.invisibleNotes]) {
    add(note.beat, note.event);
    if (note.endBeat !== undefined && lanes.includes(note.channel) && !rows.has(note.endBeat))
      add(note.endBeat, eventAtBeat(resolved, note.endBeat, maxMeasure));
  }
  return [...rows.values()].sort((a, b) => a.beat - b.beat);
}

function eventAtBeat(resolved: ResolvedChart, beat: number, maxMeasure: number): Timeline['event'] {
  let low = 0,
    high = Math.max(1, maxMeasure + 1);
  while (resolved.beatResolver.measureToBeat(high) <= beat) high *= 2;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (resolved.beatResolver.measureToBeat(mid) <= beat) low = mid;
    else high = mid - 1;
  }
  const measure = low;
  const start = resolved.beatResolver.measureToBeat(measure);
  const length = resolved.beatResolver.measureToBeat(measure + 1) - start;
  const resolution = resolved.source.bmson.info.resolution || 240;
  return { measure, position: [Math.round((beat - start) * resolution), Math.round(length * resolution)] };
}

function makeMine(row: Timeline, channel: string, seconds: number, damage: number, silent: boolean): TimedLandmineNote {
  return {
    channel,
    beat: row.beat,
    seconds,
    judged: false,
    mine: true,
    ...(silent ? { silent: true } : {}),
    event: {
      measure: row.event.measure,
      position: [...row.event.position],
      channel: `${channel[0] === '1' ? 'D' : 'E'}${channel[1]}`,
      value: '0A',
      bmson: { damage },
    },
  };
}
