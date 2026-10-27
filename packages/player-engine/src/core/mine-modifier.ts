import type { ResolvedChart } from '@be-music/chart-model';
import { resolveModifierLanes, collectModifierTimelines, type ModifierTimeline } from './chart-modifier-timelines.ts';
import { toTimedLandmineNote, type TimedLandmineNote, type TimedPlayableNote } from '../playable-notes.ts';

export type MineModifier = 'OFF' | 'REMOVE' | 'ADD_RANDOM' | 'ADD_NEAR' | 'ADD_BLANK';

/** Effective mine placements from a replay; random generation is bypassed when these are supplied. */
export interface MinePlacement {
  channel: string;
  sourceChannel?: string;
  timeUs: number;
  damage?: number;
  silent?: boolean;
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
  const lanes = resolveModifierLanes(resolved, options.laneModeExtension);
  const timelines = collectModifierTimelines(resolved, lanes);
  if (options.placements !== undefined) {
    if (options.placements.length < original.length)
      throw new RangeError('Recorded added-mine population is missing authored mines.');
    const rows = new Map(timelines.map((row) => [Math.round(resolved.timing.beatToSeconds(row.beat) * 1e6), row]));
    const mines = options.placements.map((placement) => {
      const row = rows.get(placement.timeUs);
      if (!row) throw new RangeError('Recorded mine is not on a source timeline.');
      if (
        !/^[12][0-9A-Z]$/.test(placement.channel) ||
        (placement.sourceChannel !== undefined && !/^[12][0-9A-Z]$/.test(placement.sourceChannel))
      )
        throw new RangeError('Invalid recorded mine lane.');
      const damage = placement.damage ?? 4;
      if (!Number.isFinite(damage) || damage < 0) throw new RangeError('Invalid recorded mine damage.');
      return makeMine(
        row,
        placement.channel,
        placement.timeUs / 1e6,
        damage,
        placement.silent === true,
        placement.sourceChannel,
      );
    });
    return { mines, changes: Math.max(0, mines.length - original.length) };
  }
  if (mode === 'ADD_RANDOM' && !options.random)
    throw new RangeError('Mine ADD RANDOM requires supplied randomness or recorded placements.');
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
    // Snapshot before generation: newly inserted mines must not expand ADD NEAR.
    const blank = lanes.map((lane) => !occupied.has(lane) && !held.has(lane));
    for (const [index, lane] of lanes.entries()) {
      if (!blank[index]) continue;
      let add = false;
      if (mode === 'ADD_BLANK') {
        add = true;
      } else if (mode === 'ADD_NEAR') {
        add = (index > 0 && !blank[index - 1]) || (index < lanes.length - 1 && !blank[index + 1]);
      } else {
        const draw = options.random!();
        if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new RangeError('Mine randomness must be in [0, 1).');
        add = draw > 0.9;
      }
      if (add) mines.push(makeMine(row, lane, resolved.timing.beatToSeconds(row.beat), 10, true));
    }
  }
  mines.sort((a, b) => a.beat - b.beat || lanes.indexOf(a.channel) - lanes.indexOf(b.channel));
  return { mines, changes: mines.length - original.length };
}

function makeMine(
  row: ModifierTimeline,
  channel: string,
  seconds: number,
  damage: number,
  silent: boolean,
  sourceChannel = channel,
): TimedLandmineNote {
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
      channel: `${sourceChannel[0] === '1' ? 'D' : 'E'}${sourceChannel[1]}`,
      value: '0A',
      bmson: { damage },
    },
  };
}
