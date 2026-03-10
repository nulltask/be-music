import {
  createBeatResolver,
  isPlayableChannel,
  resolveBmsLongNotes,
  resolveLnobjLongNotes,
  type BeMusicEvent,
  type BeMusicJson,
  normalizeChannel,
  sortEvents,
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

export function extractTimedNotes(
  json: BeMusicJson,
  options: ExtractTimedNotesOptions = {},
): ExtractTimedNotesResult {
  const includeLandmine = options.includeLandmine !== false;
  const includeInvisible = options.includeInvisible === true;
  const context = createTimedExtractionContext(json);
  const playableNotes = collectPlayableNotes(context);
  const landmineNotes = includeLandmine ? collectLandmineNotes(context) : [];
  const invisibleNotes = includeInvisible ? collectInvisibleNotes(context) : [];

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
  const playableNotes = collectPlayableNotes(context);
  finalizePlayableNotes(json, playableNotes, context.resolver, options);
  return playableNotes;
}

export function extractLandmineNotes(json: BeMusicJson): TimedLandmineNote[] {
  return collectLandmineNotes(createTimedExtractionContext(json));
}

export function extractInvisiblePlayableNotes(json: BeMusicJson): TimedPlayableNote[] {
  return collectInvisibleNotes(createTimedExtractionContext(json));
}

function createTimedExtractionContext(json: BeMusicJson): TimedExtractionContext {
  return {
    resolver: createTimingResolver(json),
    beatResolver: createBeatResolver(json),
    sortedEvents: sortEvents(json.events),
    bmsonResolution: json.sourceFormat === 'bmson' ? Math.max(1, json.bmson.info.resolution || 240) : undefined,
  };
}

function collectPlayableNotes(context: TimedExtractionContext): TimedPlayableNote[] {
  const notes: TimedPlayableNote[] = [];
  for (const event of context.sortedEvents) {
    const normalizedChannel = normalizeChannel(event.channel);
    if (!isPlayableChannel(normalizedChannel)) {
      continue;
    }

    const beat = context.beatResolver.eventToBeat(event);
    const endBeat = resolveLongNoteEndBeat(event, beat, normalizedChannel, context.bmsonResolution);
    notes.push({
      event,
      channel: normalizedChannel,
      beat,
      endBeat,
      endSeconds: endBeat !== undefined ? context.resolver.beatToSeconds(endBeat) : undefined,
      longNoteMode: endBeat !== undefined ? DEFAULT_OTHER_LONG_NOTE_MODE : undefined,
      seconds: context.resolver.beatToSeconds(beat),
      judged: false,
    });
  }
  return notes;
}

function collectLandmineNotes(context: TimedExtractionContext): TimedLandmineNote[] {
  const notes: TimedLandmineNote[] = [];
  for (const event of context.sortedEvents) {
    const mappedChannel = mapLandmineNormalizedChannelToPlayableLane(normalizeChannel(event.channel));
    if (!mappedChannel) {
      continue;
    }

    const beat = context.beatResolver.eventToBeat(event);
    notes.push({
      event,
      channel: mappedChannel,
      beat,
      seconds: context.resolver.beatToSeconds(beat),
      judged: false,
      mine: true,
    });
  }
  return notes;
}

function collectInvisibleNotes(context: TimedExtractionContext): TimedPlayableNote[] {
  const notes: TimedPlayableNote[] = [];
  for (const event of context.sortedEvents) {
    const mappedChannel = mapInvisibleNormalizedChannelToPlayableLane(normalizeChannel(event.channel));
    if (!mappedChannel) {
      continue;
    }

    const beat = context.beatResolver.eventToBeat(event);
    notes.push({
      event,
      channel: mappedChannel,
      beat,
      seconds: context.resolver.beatToSeconds(beat),
      judged: false,
      invisible: true,
    });
  }
  return notes;
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
    inferLnTypeWhenMissing: options.inferBmsLnTypeWhenMissing === true,
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

function mapLandmineNormalizedChannelToPlayableLane(normalized: string): string | undefined {
  if (normalized.length !== 2) {
    return undefined;
  }
  const lane = normalized[1];
  const laneCode = normalized.charCodeAt(1);
  if (laneCode < 0x31 || laneCode > 0x39) {
    return undefined;
  }
  const sideCode = normalized.charCodeAt(0);
  if (sideCode === 0x44) {
    return `1${lane}`;
  }
  if (sideCode === 0x45) {
    return `2${lane}`;
  }
  return undefined;
}

function mapInvisibleNormalizedChannelToPlayableLane(normalized: string): string | undefined {
  if (normalized.length !== 2) {
    return undefined;
  }
  const lane = normalized[1];
  const laneCode = normalized.charCodeAt(1);
  if (laneCode < 0x31 || laneCode > 0x39) {
    return undefined;
  }
  const sideCode = normalized.charCodeAt(0);
  if (sideCode === 0x33) {
    return `1${lane}`;
  }
  if (sideCode === 0x34) {
    return `2${lane}`;
  }
  return undefined;
}
