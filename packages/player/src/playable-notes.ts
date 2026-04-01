import {
  createBeatResolver,
  resolveBmsLongNotes,
  resolveLnobjLongNotes,
  sortEvents,
} from '@be-music/chart';
import {
  type BeMusicEvent,
  type BeMusicJson,
  normalizeChannel,
} from '@be-music/json';
import { createTimingResolver } from '@be-music/audio-renderer';
const FREE_ZONE_BEAT_LENGTH = 1;
const DEFAULT_BMS_LONG_NOTE_MODE = 1;
const DEFAULT_OTHER_LONG_NOTE_MODE = 2;

export type LongNoteMode = 1 | 2 | 3;

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
}

export interface ExtractTimedNotesOptions {
  includeLandmine?: boolean;
  includeInvisible?: boolean;
  inferBmsLnTypeWhenMissing?: boolean;
}

export interface ExtractTimedNotesResult {
  playableNotes: TimedPlayableNote[];
  landmineNotes: TimedLandmineNote[];
  invisibleNotes: TimedPlayableNote[];
}

export interface ExtractPlayableNotesOptions {
  inferBmsLnTypeWhenMissing?: boolean;
}

interface TimedExtractionContext {
  resolver: ReturnType<typeof createTimingResolver>;
  beatResolver: ReturnType<typeof createBeatResolver>;
  sortedEvents: BeMusicEvent[];
  bmsonResolution?: number;
}

interface TimedEventChannels {
  playable?: string;
  landmine?: string;
  invisible?: string;
}

export function extractTimedNotes(
  json: BeMusicJson,
  options: ExtractTimedNotesOptions = {},
): ExtractTimedNotesResult {
  const context = createTimedExtractionContext(json);
  const { playableNotes, landmineNotes, invisibleNotes } = collectTimedNotes(context, {
    includePlayable: true,
    includeLandmine: options.includeLandmine !== false,
    includeInvisible: Boolean(options.includeInvisible),
  });

  finalizePlayableNotes(json, playableNotes, context.resolver, options);
  return {
    playableNotes,
    landmineNotes,
    invisibleNotes,
  };
}

export function extractPlayableNotes(
  json: BeMusicJson,
  options: ExtractPlayableNotesOptions = {},
): TimedPlayableNote[] {
  const context = createTimedExtractionContext(json);
  const { playableNotes } = collectTimedNotes(context, { includePlayable: true });
  finalizePlayableNotes(json, playableNotes, context.resolver, options);
  return playableNotes;
}

export function extractLandmineNotes(json: BeMusicJson): TimedLandmineNote[] {
  return collectTimedNotes(createTimedExtractionContext(json), {
    includePlayable: false,
    includeLandmine: true,
  }).landmineNotes;
}

export function extractInvisiblePlayableNotes(json: BeMusicJson): TimedPlayableNote[] {
  return collectTimedNotes(createTimedExtractionContext(json), {
    includePlayable: false,
    includeInvisible: true,
  }).invisibleNotes;
}

function createTimedExtractionContext(json: BeMusicJson): TimedExtractionContext {
  return {
    resolver: createTimingResolver(json),
    beatResolver: createBeatResolver(json),
    sortedEvents: sortEvents(json.events),
    bmsonResolution: json.sourceFormat === 'bmson' ? Math.max(1, json.bmson.info.resolution || 240) : undefined,
  };
}

function collectTimedNotes(
  context: TimedExtractionContext,
  options: {
    includePlayable?: boolean;
    includeLandmine?: boolean;
    includeInvisible?: boolean;
  } = {},
): ExtractTimedNotesResult {
  const includePlayable = options.includePlayable !== false;
  const includeLandmine = Boolean(options.includeLandmine);
  const includeInvisible = Boolean(options.includeInvisible);
  const playableNotes: TimedPlayableNote[] = [];
  const landmineNotes: TimedLandmineNote[] = [];
  const invisibleNotes: TimedPlayableNote[] = [];

  for (const event of context.sortedEvents) {
    const normalizedChannel = normalizeChannel(event.channel);
    const {
      playable: playableChannel,
      landmine: landmineChannel,
      invisible: invisibleChannel,
    } = resolveTimedEventChannels(normalizedChannel, includePlayable, includeLandmine, includeInvisible);

    if (!playableChannel && !landmineChannel && !invisibleChannel) {
      continue;
    }

    const beat = context.beatResolver.eventToBeat(event);
    const seconds = context.resolver.beatToSeconds(beat);

    if (playableChannel) {
      const endBeat = resolveLongNoteEndBeat(event, beat, playableChannel, context.bmsonResolution);
      playableNotes.push({
        event,
        channel: playableChannel,
        beat,
        endBeat,
        endSeconds: endBeat !== undefined ? context.resolver.beatToSeconds(endBeat) : undefined,
        longNoteMode: endBeat !== undefined ? DEFAULT_OTHER_LONG_NOTE_MODE : undefined,
        seconds,
        judged: false,
      });
    }

    if (landmineChannel) {
      landmineNotes.push({
        event,
        channel: landmineChannel,
        beat,
        seconds,
        judged: false,
        mine: true,
      });
    }

    if (invisibleChannel) {
      invisibleNotes.push({
        event,
        channel: invisibleChannel,
        beat,
        seconds,
        judged: false,
        invisible: true,
      });
    }
  }

  return {
    playableNotes,
    landmineNotes,
    invisibleNotes,
  };
}

function resolveTimedEventChannels(
  normalizedChannel: string,
  includePlayable: boolean,
  includeLandmine: boolean,
  includeInvisible: boolean,
): TimedEventChannels {
  if (normalizedChannel.length !== 2) {
    return {};
  }

  const laneCode = normalizedChannel.charCodeAt(1);
  if (laneCode < 0x31 || laneCode > 0x39) {
    return {};
  }

  const sideCode = normalizedChannel.charCodeAt(0);
  const lane = normalizedChannel[1]!;
  const playableLane = sideCode === 0x44 || sideCode === 0x33 ? `1${lane}` : `2${lane}`;

  if (includePlayable && (sideCode === 0x31 || sideCode === 0x32)) {
    return {
      playable: normalizedChannel,
    };
  }
  if (includeLandmine && (sideCode === 0x44 || sideCode === 0x45)) {
    return {
      landmine: playableLane,
    };
  }
  if (includeInvisible && (sideCode === 0x33 || sideCode === 0x34)) {
    return {
      invisible: playableLane,
    };
  }
  return {};
}

function finalizePlayableNotes(
  json: BeMusicJson,
  notes: TimedPlayableNote[],
  resolver: ReturnType<typeof createTimingResolver>,
  options: Pick<ExtractTimedNotesOptions, 'inferBmsLnTypeWhenMissing'>,
): void {
  const bmsLongNoteMode = resolveBmsLongNoteMode(json);
  applyLnobjEndBeatIfNeeded(json, notes, resolver, bmsLongNoteMode);
  appendLegacyLongNotesIfNeeded(json, notes, resolver, options, bmsLongNoteMode);
  notes.sort(comparePlayableNotes);
}

function comparePlayableNotes(left: TimedPlayableNote, right: TimedPlayableNote): number {
  if (left.beat !== right.beat) {
    return left.beat - right.beat;
  }
  if (left.channel !== right.channel) {
    return left.channel < right.channel ? -1 : 1;
  }
  if (left.event.value !== right.event.value) {
    return left.event.value < right.event.value ? -1 : 1;
  }
  return 0;
}

function applyLnobjEndBeatIfNeeded(
  json: BeMusicJson,
  notes: TimedPlayableNote[],
  resolver: ReturnType<typeof createTimingResolver>,
  longNoteMode: LongNoteMode,
): void {
  if (json.sourceFormat !== 'bms') {
    return;
  }
  const resolved = resolveLnobjLongNotes(json);
  if (resolved.startToEndBeat.size === 0) {
    return;
  }
  let writeIndex = 0;
  for (const note of notes) {
    if (resolved.endEvents.has(note.event)) {
      continue;
    }
    if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
      notes[writeIndex] = note;
      writeIndex += 1;
      continue;
    }
    const endBeat = resolved.startToEndBeat.get(note.event);
    if (typeof endBeat !== 'number' || !Number.isFinite(endBeat) || endBeat <= note.beat) {
      notes[writeIndex] = note;
      writeIndex += 1;
      continue;
    }
    note.endBeat = endBeat;
    note.endSeconds = resolver.beatToSeconds(endBeat);
    note.longNoteMode = longNoteMode;
    notes[writeIndex] = note;
    writeIndex += 1;
  }
  notes.length = writeIndex;
}

function appendLegacyLongNotesIfNeeded(
  json: BeMusicJson,
  notes: TimedPlayableNote[],
  resolver: ReturnType<typeof createTimingResolver>,
  options: Pick<ExtractTimedNotesOptions, 'inferBmsLnTypeWhenMissing'>,
  longNoteMode: LongNoteMode,
): void {
  if (json.sourceFormat !== 'bms') {
    return;
  }
  const resolved = resolveBmsLongNotes(json, {
    inferLnTypeWhenMissing: Boolean(options.inferBmsLnTypeWhenMissing),
  });
  if (resolved.notes.length === 0) {
    return;
  }
  for (const longNote of resolved.notes) {
    const endBeat = typeof longNote.endBeat === 'number' && longNote.endBeat > longNote.beat ? longNote.endBeat : undefined;
    notes.push({
      event: longNote.event,
      channel: longNote.channel,
      beat: longNote.beat,
      endBeat,
      endSeconds: endBeat !== undefined ? resolver.beatToSeconds(endBeat) : undefined,
      longNoteMode: endBeat !== undefined ? longNoteMode : undefined,
      seconds: resolver.beatToSeconds(longNote.beat),
      judged: false,
    });
  }
}

function resolveBmsLongNoteMode(json: BeMusicJson): LongNoteMode {
  if (json.sourceFormat !== 'bms') {
    return DEFAULT_OTHER_LONG_NOTE_MODE;
  }
  if (json.bms.lnMode === 2 || json.bms.lnMode === 3) {
    return json.bms.lnMode;
  }
  return DEFAULT_BMS_LONG_NOTE_MODE;
}

function resolveLongNoteEndBeat(
  event: BeMusicEvent,
  beat: number,
  normalizedChannel = normalizeChannel(event.channel),
  bmsonResolution?: number,
): number | undefined {
  if (isFreeZoneNormalizedChannel(normalizedChannel)) {
    return beat + FREE_ZONE_BEAT_LENGTH;
  }

  if (event.bmson?.l && event.bmson.l > 0 && typeof bmsonResolution === 'number') {
    return beat + event.bmson.l / bmsonResolution;
  }
  return undefined;
}

function isFreeZoneNormalizedChannel(normalized: string): boolean {
  return normalized === '17' || normalized === '27';
}
