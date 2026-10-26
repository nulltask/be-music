import { resolveModifierLanes, collectModifierTimelines } from './chart-modifier-timelines.ts';
import type { LongNoteMode, ResolvedChart } from '@be-music/chart-model';
import type { TimedPlayableNote } from '../playable-notes.ts';

/** Applies the source's head-only modifier to fresh play notes, retaining the head's keysound and timing. */
export function removeLongNoteTails(
  notes: TimedPlayableNote[],
  mode: 'OFF' | 'LEGACY' | 'REMOVE',
  chartLNMode: LongNoteMode,
): number {
  if (mode === 'OFF') return 0;
  let changed = 0;
  for (const note of notes) {
    if (note.endSeconds === undefined || note.endSeconds <= note.seconds) continue;
    if (mode === 'LEGACY' && (note.longNoteMode ?? chartLNMode) !== 2) continue;
    delete note.endSeconds;
    delete note.endBeat;
    delete note.longNoteMode;
    delete note.visibleUntilBeat;
    changed += 1;
  }
  return changed;
}

export type LongNoteModifier = 'OFF' | 'LEGACY' | 'REMOVE' | 'ADD_LN' | 'ADD_CN' | 'ADD_HCN' | 'ADD_ALL';

/** Recorded head identity and generated endpoint, before lane transforms. */
export interface LongNotePlacement {
  sourceChannel: string;
  timeUs: number;
  endTimeUs: number;
  lnMode: LongNoteMode;
}

/** Source PlayerConfig default 1.0, validation range 0..1. */
export function clampLongNoteRate(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

/**
 * beatoraja 0.8.9: replace an eligible NormalNote with an LN ending on the immediately
 * following decoder timeline, if that cell is empty. The supplied notes are fresh mutable
 * playback objects; the source chart and source events remain unchanged.
 */
export function addLongNotes(
  resolved: ResolvedChart,
  notes: TimedPlayableNote[],
  mode: Extract<LongNoteModifier, `ADD_${string}`>,
  options: {
    rate?: number;
    random?: () => number;
    laneModeExtension?: string;
    placements?: readonly LongNotePlacement[];
  } = {},
): number {
  if (mode !== 'ADD_LN' && mode !== 'ADD_CN' && mode !== 'ADD_HCN' && mode !== 'ADD_ALL')
    throw new RangeError('Unsupported long-note addition mode.');
  const addedMode: LongNoteMode = mode === 'ADD_LN' ? 1 : mode === 'ADD_CN' ? 2 : 3;
  const lanes = resolveModifierLanes(resolved, options.laneModeExtension);
  const timelines = collectModifierTimelines(resolved, lanes);
  const rate = clampLongNoteRate(options.rate ?? 1);
  const occupied = new Map<number, Set<string>>();
  const heads = new Map<number, Map<string, TimedPlayableNote>>();
  const occupy = (beat: number, channel: string): void => {
    const cells = occupied.get(beat) ?? new Set<string>();
    cells.add(channel);
    occupied.set(beat, cells);
  };
  for (const note of notes) {
    occupy(note.beat, note.channel);
    const row = heads.get(note.beat) ?? new Map<string, TimedPlayableNote>();
    row.set(note.channel, note);
    heads.set(note.beat, row);
    if (note.endBeat !== undefined) occupy(note.endBeat, note.channel);
  }
  for (const mine of resolved.mines) occupy(mine.beat, mine.channel);
  const recorded = new Map<string, LongNotePlacement>();
  for (const placement of options.placements ?? []) {
    const key = `${placement.sourceChannel}:${placement.timeUs}`;
    if (
      !/^[12][0-9A-Z]$/.test(placement.sourceChannel) ||
      !Number.isSafeInteger(placement.timeUs) ||
      !Number.isSafeInteger(placement.endTimeUs) ||
      placement.endTimeUs <= placement.timeUs ||
      ![1, 2, 3].includes(placement.lnMode) ||
      (mode !== 'ADD_ALL' && placement.lnMode !== addedMode) ||
      recorded.has(key)
    )
      throw new RangeError('Invalid recorded long-note addition placement.');
    recorded.set(key, placement);
  }
  const additions: Array<{ note: TimedPlayableNote; beat: number; seconds: number; lnMode: LongNoteMode }> = [];
  for (let index = 0; index < timelines.length - 1; index += 1) {
    const row = timelines[index]!,
      next = timelines[index + 1]!;
    for (const lane of lanes) {
      const note = heads.get(row.beat)?.get(lane);
      if (!note || (note.endBeat !== undefined && note.endBeat > note.beat) || occupied.get(next.beat)?.has(lane))
        continue;
      const key = `${lane}:${Math.round(note.seconds * 1e6)}`;
      const placement = recorded.get(key);
      if (options.placements !== undefined) {
        if (!placement) continue;
        if (placement.endTimeUs !== Math.round(resolved.timing.beatToSeconds(next.beat) * 1e6))
          throw new RangeError('Recorded long-note addition tail is not the next source timeline.');
        recorded.delete(key);
      } else {
        const draw = options.random?.();
        if (draw === undefined || !Number.isFinite(draw) || draw < 0 || draw >= 1)
          throw new RangeError('Long-note addition requires supplied randomness in [0, 1) or recorded placements.');
        if (!(draw < rate)) continue;
      }
      let lnMode = placement?.lnMode ?? addedMode;
      if (mode === 'ADD_ALL' && options.placements === undefined) {
        const draw = options.random?.();
        if (draw === undefined || !Number.isFinite(draw) || draw < 0 || draw >= 1)
          throw new RangeError('Mixed long-note type randomness must be in [0, 1).');
        lnMode = (Math.floor(draw * 3) + 1) as LongNoteMode;
      }
      additions.push({ note, beat: next.beat, seconds: resolved.timing.beatToSeconds(next.beat), lnMode });
      occupy(next.beat, lane);
    }
  }
  if (recorded.size > 0 || (options.placements !== undefined && rate === 0 && additions.length > 0))
    throw new RangeError('Recorded long-note addition head is not an eligible source note.');
  for (const { note, beat, seconds, lnMode } of additions) {
    note.endBeat = beat;
    note.endSeconds = seconds;
    note.longNoteMode = lnMode;
    note.generatedLongNote = true;
  }
  return additions.length;
}
