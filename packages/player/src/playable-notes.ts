import {
  createBeatResolver,
  type BeMusicEvent,
  type BeMusicJson,
  isLandmineChannel,
  isPlayableChannel,
  normalizeChannel,
  normalizeObjectKey,
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

export function extractPlayableNotes(json: BeMusicJson): TimedPlayableNote[] {
  const resolver = createTimingResolver(json);
  const beatResolver = createBeatResolver(json);
  const notes = sortEvents(json.events)
    .filter((event) => isPlayableChannel(event.channel))
    .map((event) => {
      const beat = beatResolver.eventToBeat(event);
      const endBeat = resolveLongNoteEndBeat(json, event, beat);
      return {
        event,
        channel: normalizeChannel(event.channel),
        beat,
        endBeat,
        endSeconds: endBeat !== undefined ? resolver.beatToSeconds(endBeat) : undefined,
        seconds: resolver.beatToSeconds(beat),
        judged: false,
      };
    })
    .sort((left, right) => left.seconds - right.seconds);

  applyLnobjEndBeatIfNeeded(json, notes, resolver);
  return notes;
}

export function extractLandmineNotes(json: BeMusicJson): TimedLandmineNote[] {
  const resolver = createTimingResolver(json);
  const beatResolver = createBeatResolver(json);
  return sortEvents(json.events)
    .filter((event) => isLandmineChannel(event.channel))
    .map((event) => {
      const mappedChannel = mapLandmineChannelToPlayableLane(event.channel);
      if (!mappedChannel) {
        return undefined;
      }
      const beat = beatResolver.eventToBeat(event);
      return {
        event,
        channel: mappedChannel,
        beat,
        seconds: resolver.beatToSeconds(beat),
        judged: false,
        mine: true as const,
      };
    })
    .filter((note): note is TimedLandmineNote => note !== undefined)
    .sort((left, right) => left.seconds - right.seconds);
}

export function extractInvisiblePlayableNotes(json: BeMusicJson): TimedPlayableNote[] {
  const resolver = createTimingResolver(json);
  const beatResolver = createBeatResolver(json);
  return sortEvents(json.events)
    .map((event): TimedPlayableNote | undefined => {
      const mappedChannel = mapInvisibleChannelToPlayableLane(event.channel);
      if (!mappedChannel) {
        return undefined;
      }
      const beat = beatResolver.eventToBeat(event);
      return {
        event,
        channel: mappedChannel,
        beat,
        seconds: resolver.beatToSeconds(beat),
        judged: false,
        invisible: true,
      };
    })
    .filter((note): note is TimedPlayableNote => note !== undefined)
    .sort((left, right) => left.seconds - right.seconds);
}

function applyLnobjEndBeatIfNeeded(
  json: BeMusicJson,
  notes: TimedPlayableNote[],
  resolver: ReturnType<typeof createTimingResolver>,
): void {
  if (json.sourceFormat !== 'bms') {
    return;
  }

  const lnObj =
    typeof json.bms.lnObj === 'string' && json.bms.lnObj.length > 0 ? normalizeObjectKey(json.bms.lnObj) : undefined;
  if (!lnObj) {
    return;
  }

  const pendingStartByChannel = new Map<string, TimedPlayableNote>();
  for (const note of notes) {
    const value = normalizeObjectKey(note.event.value);
    if (value === lnObj) {
      const start = pendingStartByChannel.get(note.channel);
      if (start && note.beat > start.beat) {
        start.endBeat = note.beat;
        start.endSeconds = resolver.beatToSeconds(note.beat);
      }
      pendingStartByChannel.delete(note.channel);
      continue;
    }
    pendingStartByChannel.set(note.channel, note);
  }
}

function resolveLongNoteEndBeat(json: BeMusicJson, event: BeMusicEvent, beat: number): number | undefined {
  if (isFreeZoneChannel(event.channel)) {
    return beat + FREE_ZONE_BEAT_LENGTH;
  }

  if (event.bmson?.l && event.bmson.l > 0 && json.sourceFormat === 'bmson') {
    const resolution = Math.max(1, json.bmson.info.resolution || 240);
    return beat + event.bmson.l / resolution;
  }
  return undefined;
}

function isFreeZoneChannel(channel: string): boolean {
  const normalized = normalizeChannel(channel);
  return normalized === '17' || normalized === '27';
}

function mapLandmineChannelToPlayableLane(channel: string): string | undefined {
  const normalized = normalizeChannel(channel);
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

function mapInvisibleChannelToPlayableLane(channel: string): string | undefined {
  const normalized = normalizeChannel(channel);
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
