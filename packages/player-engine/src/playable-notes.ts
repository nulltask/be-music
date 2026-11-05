import { resolveChart, type ChartPlayVariant, type LongNoteMode, type ResolvedNote } from '@be-music/chart-model';
import type { BeMusicEvent, BeMusicJSON } from '@be-music/chart-source';

/**
 * A judged (or invisible) note as the engine plays it: a {@link ResolvedNote} from `resolveChart` (`@be-music/chart-model`)
 * plus the per-play state the engine mutates (`judged`, and `channel` under lane options).
 */
export interface TimedPlayableNote {
  event: BeMusicEvent;
  /** Constituent bmson source events, including `event`, sounded by the same input. */
  soundEvents?: readonly BeMusicEvent[];
  /** bmson up source slice attached to the long-note tail. */
  endSoundEvent?: BeMusicEvent;
  channel: string;
  beat: number;
  endBeat?: number;
  endSeconds?: number;
  longNoteMode?: LongNoteMode;
  /** Added by the source long-note modifier; its effective endpoint is recorded for replay. */
  generatedLongNote?: true;
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
   * their keysound still belongs to the chart: BMS plays it as background audio, while bmson binds it to the
   * judged note through `soundEvents`.
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

/**
 * Every play note carries every field from creation, in one order, with `undefined` for an absent one: notes then share
 * one V8 hidden class, so the judge loop's property reads stay monomorphic. Clear a field by assigning `undefined`, never
 * `delete` (that drops the object into dictionary mode). JSON drops the `undefined` keys.
 */
function createTimedPlayableNote(
  note: ResolvedNote,
  invisible: true | undefined,
  soundEvents: readonly BeMusicEvent[] | undefined,
  endSoundEvent: BeMusicEvent | undefined,
  endBeat: number | undefined,
  endSeconds: number | undefined,
  longNoteMode: LongNoteMode | undefined,
): TimedPlayableNote {
  return {
    event: note.event,
    soundEvents,
    endSoundEvent,
    channel: note.channel,
    beat: note.beat,
    endBeat,
    endSeconds,
    longNoteMode,
    generatedLongNote: undefined,
    visibleUntilBeat: undefined,
    seconds: note.seconds,
    judged: false,
    invisible,
  };
}

/** A fresh play note for a resolved judged (`tap` / `ln`) note. */
export function toTimedPlayableNote(note: ResolvedNote): TimedPlayableNote {
  return createTimedPlayableNote(
    note,
    undefined,
    note.soundEvents,
    note.endSoundEvent,
    note.endBeat,
    note.endSeconds,
    note.lnMode,
  );
}

/** A fresh play note for a resolved invisible object. */
export function toTimedInvisibleNote(note: ResolvedNote): TimedPlayableNote {
  return createTimedPlayableNote(note, true, undefined, undefined, undefined, undefined, undefined);
}

/** A fresh play mine, every field present in one order (see {@link createTimedPlayableNote}). */
export function createTimedLandmineNote(
  event: BeMusicEvent,
  channel: string,
  beat: number,
  seconds: number,
  silent: true | undefined,
): TimedLandmineNote {
  return { event, channel, beat, seconds, judged: false, mine: true, silent };
}

/** A fresh play note for a resolved mine. */
export function toTimedLandmineNote(note: ResolvedNote): TimedLandmineNote {
  return createTimedLandmineNote(note.event, note.channel, note.beat, note.seconds, undefined);
}
