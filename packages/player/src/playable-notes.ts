import {
  createBeatResolver,
  resolveBmsLongNotes,
  resolveLnobjLongNotes,
  type BeMusicEvent,
  type BeMusicJson,
  isPlayableChannel,
  normalizeChannel,
  sortEvents,
} from '@be-music/json';
import { createTimingResolver } from '@be-music/audio-renderer';
const FREE_ZONE_BEAT_LENGTH = 1;

export interface TimedPlayableNote {
  event: BeMusicEvent;
  channel: string;
  beat: number;
  endBeat?: number;
  endSeconds?: number;
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

export function extractTimedNotes(
  json: BeMusicJson,
  options: ExtractTimedNotesOptions = {},
): ExtractTimedNotesResult {
  const includeLandmine = options.includeLandmine !== false;
  const includeInvisible = options.includeInvisible === true;
  const resolver = createTimingResolver(json);
  const beatResolver = createBeatResolver(json);
  const sortedEvents = sortEvents(json.events);
  const playableNotes: TimedPlayableNote[] = [];
  const landmineNotes: TimedLandmineNote[] = [];
  const invisibleNotes: TimedPlayableNote[] = [];

  for (const event of sortedEvents) {
    const normalizedChannel = normalizeChannel(event.channel);

    if (isPlayableChannel(normalizedChannel)) {
      const beat = beatResolver.eventToBeat(event);
      const endBeat = resolveLongNoteEndBeat(json, event, beat, normalizedChannel);
      playableNotes.push({
        event,
        channel: normalizedChannel,
        beat,
        endBeat,
        endSeconds: endBeat !== undefined ? resolver.beatToSeconds(endBeat) : undefined,
        seconds: resolver.beatToSeconds(beat),
        judged: false,
      });
      continue;
    }

    if (includeLandmine) {
      const mappedLandmineChannel = mapLandmineNormalizedChannelToPlayableLane(normalizedChannel);
      if (mappedLandmineChannel) {
        const beat = beatResolver.eventToBeat(event);
        landmineNotes.push({
          event,
          channel: mappedLandmineChannel,
          beat,
          seconds: resolver.beatToSeconds(beat),
          judged: false,
          mine: true,
        });
        continue;
      }
    }

    if (includeInvisible) {
      const mappedInvisibleChannel = mapInvisibleNormalizedChannelToPlayableLane(normalizedChannel);
      if (mappedInvisibleChannel) {
        const beat = beatResolver.eventToBeat(event);
        invisibleNotes.push({
          event,
          channel: mappedInvisibleChannel,
          beat,
          seconds: resolver.beatToSeconds(beat),
          judged: false,
          invisible: true,
        });
      }
    }
  }

  applyLnobjEndBeatIfNeeded(json, playableNotes, resolver);
  appendLegacyLongNotesIfNeeded(json, playableNotes, resolver, options);
  playableNotes.sort((left, right) => {
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
  });
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
  return extractTimedNotes(json, {
    includeLandmine: false,
    includeInvisible: false,
    inferBmsLnTypeWhenMissing: options.inferBmsLnTypeWhenMissing,
  }).playableNotes;
}

export function extractLandmineNotes(json: BeMusicJson): TimedLandmineNote[] {
  return extractTimedNotes(json, {
    includeLandmine: true,
    includeInvisible: false,
  }).landmineNotes;
}

export function extractInvisiblePlayableNotes(json: BeMusicJson): TimedPlayableNote[] {
  return extractTimedNotes(json, {
    includeLandmine: false,
    includeInvisible: true,
  }).invisibleNotes;
}

function applyLnobjEndBeatIfNeeded(
  json: BeMusicJson,
  notes: TimedPlayableNote[],
  resolver: ReturnType<typeof createTimingResolver>,
): void {
  const resolved = resolveLnobjLongNotes(json);
  if (resolved.startToEndBeat.size === 0) {
    return;
  }
  for (const note of notes) {
    if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
      continue;
    }
    const endBeat = resolved.startToEndBeat.get(note.event);
    if (typeof endBeat !== 'number' || !Number.isFinite(endBeat) || endBeat <= note.beat) {
      continue;
    }
    note.endBeat = endBeat;
    note.endSeconds = resolver.beatToSeconds(endBeat);
  }
}

function appendLegacyLongNotesIfNeeded(
  json: BeMusicJson,
  notes: TimedPlayableNote[],
  resolver: ReturnType<typeof createTimingResolver>,
  options: Pick<ExtractTimedNotesOptions, 'inferBmsLnTypeWhenMissing'>,
): void {
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
      seconds: resolver.beatToSeconds(longNote.beat),
      judged: false,
    });
  }
}

function resolveLongNoteEndBeat(
  json: BeMusicJson,
  event: BeMusicEvent,
  beat: number,
  normalizedChannel = normalizeChannel(event.channel),
): number | undefined {
  if (isFreeZoneNormalizedChannel(normalizedChannel)) {
    return beat + FREE_ZONE_BEAT_LENGTH;
  }

  if (event.bmson?.l && event.bmson.l > 0 && json.sourceFormat === 'bmson') {
    const resolution = Math.max(1, json.bmson.info.resolution || 240);
    return beat + event.bmson.l / resolution;
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
  const side = normalized[0];
  const lane = normalized[1];
  if (lane < '1' || lane > '9') {
    return undefined;
  }
  if (side === 'D') {
    return `1${lane}`;
  }
  if (side === 'E') {
    return `2${lane}`;
  }
  return undefined;
}

function mapInvisibleNormalizedChannelToPlayableLane(normalized: string): string | undefined {
  if (normalized.length !== 2) {
    return undefined;
  }
  const side = normalized[0];
  const lane = normalized[1];
  if (lane < '1' || lane > '9') {
    return undefined;
  }
  if (side === '3') {
    return `1${lane}`;
  }
  if (side === '4') {
    return `2${lane}`;
  }
  return undefined;
}
