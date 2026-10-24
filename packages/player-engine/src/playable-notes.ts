import { resolveChart, type ChartPlayVariant, type LongNoteMode, type ResolvedNote } from '@be-music/chart-model';
import type { BeMusicEvent, BeMusicJSON } from '@be-music/chart-source';

/**
 * A judged (or invisible) note as the engine plays it: a {@link ResolvedNote} from `resolveChart` (`@be-music/chart-model`)
 * plus the per-play state the engine mutates (`judged`, and `channel` under lane options).
 */
export interface TimedPlayableNote {
  event: BeMusicEvent;
  channel: string;
  beat: number;
  endBeat?: number;
  endSeconds?: number;
  longNoteMode?: LongNoteMode;
  visibleUntilBeat?: number;
  seconds: number;
  judged: boolean;
  invisible?: true;
}

export interface TimedLandmineNote {
  event: BeMusicEvent;
  channel: string;
  beat: number;
  seconds: number;
  judged: boolean;
  mine: true;
  /** Generated beatoraja mines have no explosion sample (source WAV index -1). */
  silent?: true;
}

export interface ExtractTimedNotesOptions {
  includeLandmine?: boolean;
  includeInvisible?: boolean;
  inferBmsLNTypeWhenMissing?: boolean;
  /**
   * Host-resolved play variant. Only consulted to decide whether channels `17` / `27` are FREE ZONE — they're real key
   * columns under POPN-9 and the 24-key keyboard modes. Omit it and the chart is classified from its lanes.
   */
  playVariant?: ChartPlayVariant;
}

export interface ExtractTimedNotesResult {
  playableNotes: TimedPlayableNote[];
  landmineNotes: TimedLandmineNote[];
  invisibleNotes: TimedPlayableNote[];
  /**
   * Playable notes that start on the same lane and position as a note in `playableNotes`, with a different keysound.
   * Only one note per lane and position is judged (see {@link extractTimedNotes}); these are not judged or drawn, but
   * their keysound still belongs to the chart, so a manual-play host sounds them as background audio at their time.
   */
  shadowedNotes: TimedPlayableNote[];
}

export interface ExtractPlayableNotesOptions {
  inferBmsLNTypeWhenMissing?: boolean;
  /** See {@link ExtractTimedNotesOptions.playVariant}. */
  playVariant?: ChartPlayVariant;
}

/**
 * Extracts the chart's timed notes as fresh, mutable play notes. The notes come from `resolveChart`
 * (`@be-music/chart-model`), which owns every rule: each lane and position holds at most one judged note (a long note wins
 * over a tap, otherwise the lowest object ID / first bmson sound channel), the others are returned in `shadowedNotes`
 * when their keysound differs, and landmines and invisible objects are not collapsed.
 */
export function extractTimedNotes(json: BeMusicJSON, options: ExtractTimedNotesOptions = {}): ExtractTimedNotesResult {
  const resolved = resolveChart(json, {
    playVariant: options.playVariant,
    inferBmsLNTypeWhenMissing: options.inferBmsLNTypeWhenMissing,
  });
  return {
    playableNotes: resolved.notes.map(toTimedPlayableNote),
    landmineNotes: options.includeLandmine !== false ? resolved.mines.map(toTimedLandmineNote) : [],
    invisibleNotes: options.includeInvisible ? resolved.invisibleNotes.map(toTimedInvisibleNote) : [],
    shadowedNotes: resolved.shadowedNotes.map(toTimedPlayableNote),
  };
}

export function extractPlayableNotes(
  json: BeMusicJSON,
  options: ExtractPlayableNotesOptions = {},
): TimedPlayableNote[] {
  return resolveChart(json, options).notes.map(toTimedPlayableNote);
}

export function extractLandmineNotes(json: BeMusicJSON): TimedLandmineNote[] {
  return resolveChart(json).mines.map(toTimedLandmineNote);
}

export function extractInvisiblePlayableNotes(json: BeMusicJSON): TimedPlayableNote[] {
  return resolveChart(json).invisibleNotes.map(toTimedInvisibleNote);
}

/** A fresh play note for a resolved judged (`tap` / `ln`) note. */
export function toTimedPlayableNote(note: ResolvedNote): TimedPlayableNote {
  return {
    event: note.event,
    channel: note.channel,
    beat: note.beat,
    endBeat: note.endBeat,
    endSeconds: note.endSeconds,
    longNoteMode: note.lnMode,
    seconds: note.seconds,
    judged: false,
  };
}

/** A fresh play note for a resolved invisible object. */
export function toTimedInvisibleNote(note: ResolvedNote): TimedPlayableNote {
  return {
    event: note.event,
    channel: note.channel,
    beat: note.beat,
    seconds: note.seconds,
    judged: false,
    invisible: true,
  };
}

/** A fresh play note for a resolved mine. */
export function toTimedLandmineNote(note: ResolvedNote): TimedLandmineNote {
  return {
    event: note.event,
    channel: note.channel,
    beat: note.beat,
    seconds: note.seconds,
    judged: false,
    mine: true,
  };
}
