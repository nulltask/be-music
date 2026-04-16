import {
  createBeatResolver,
  isLandmineChannel,
  resolveBmsLongNotes,
  resolveLnobjLongNotes,
  sortEvents,
} from '../../chart/src/index.ts';
import { normalizeChannel, type BeMusicEvent, type BeMusicJson } from '@be-music/json';
import { createTimingResolver } from './timing.ts';

const FREE_ZONE_BEAT_LENGTH = 1;

export interface WebTimedPlayableNote {
  event: BeMusicEvent;
  channel: string;
  beat: number;
  seconds: number;
  endBeat?: number;
  endSeconds?: number;
}

export interface WebTimedLandmineNote {
  event: BeMusicEvent;
  channel: string;
  beat: number;
  seconds: number;
}

export interface WebTimedInvisibleNote {
  event: BeMusicEvent;
  channel: string;
  beat: number;
  seconds: number;
}

export interface WebTimedNotes {
  playableNotes: WebTimedPlayableNote[];
  landmineNotes: WebTimedLandmineNote[];
  invisibleNotes: WebTimedInvisibleNote[];
  measureTimes: number[];
  durationSeconds: number;
}

export function extractWebTimedNotes(json: BeMusicJson): WebTimedNotes {
  const resolver = createTimingResolver(json);
  const beatResolver = createBeatResolver(json);
  const sortedEvents = sortEvents(json.events);
  const bmsonResolution = json.sourceFormat === 'bmson' ? Math.max(1, json.bmson.info.resolution || 240) : undefined;

  const playableNotes: WebTimedPlayableNote[] = [];
  const landmineNotes: WebTimedLandmineNote[] = [];
  const invisibleNotes: WebTimedInvisibleNote[] = [];

  for (const event of sortedEvents) {
    const normalizedChannel = normalizeChannel(event.channel);
    const beat = beatResolver.eventToBeat(event);
    const seconds = resolver.beatToSeconds(beat);

    const playableChannel = resolvePlayableChannel(normalizedChannel);
    if (playableChannel) {
      const endBeat = resolveLongNoteEndBeat(event, beat, playableChannel, bmsonResolution);
      playableNotes.push({
        event,
        channel: playableChannel,
        beat,
        seconds,
        endBeat,
        endSeconds: endBeat !== undefined ? resolver.beatToSeconds(endBeat) : undefined,
      });
      continue;
    }

    const landmineChannel = resolveLandmineChannel(normalizedChannel);
    if (landmineChannel && isLandmineChannel(normalizedChannel)) {
      landmineNotes.push({
        event,
        channel: landmineChannel,
        beat,
        seconds,
      });
      continue;
    }

    const invisibleChannel = resolveInvisibleChannel(normalizedChannel);
    if (invisibleChannel) {
      invisibleNotes.push({
        event,
        channel: invisibleChannel,
        beat,
        seconds,
      });
    }
  }

  applyLnobjLongNotes(json, playableNotes, resolver);
  appendLegacyBmsLongNotes(json, playableNotes, resolver);
  playableNotes.sort(comparePlayableNotes);
  landmineNotes.sort((left, right) => left.seconds - right.seconds || left.channel.localeCompare(right.channel, 'en'));

  const durationSeconds = resolveDurationSeconds(playableNotes, landmineNotes, sortedEvents, resolver);
  return {
    playableNotes,
    landmineNotes,
    invisibleNotes,
    measureTimes: createMeasureTimes(json, resolver),
    durationSeconds,
  };
}

function resolvePlayableChannel(normalizedChannel: string): string | undefined {
  if (normalizedChannel.length !== 2) {
    return undefined;
  }
  const high = normalizedChannel.charCodeAt(0);
  const low = normalizedChannel.charCodeAt(1);
  if ((high === 0x31 || high === 0x32) && low >= 0x31 && low <= 0x39) {
    return normalizedChannel;
  }
  return undefined;
}

function resolveLandmineChannel(normalizedChannel: string): string | undefined {
  if (normalizedChannel.length !== 2) {
    return undefined;
  }
  const high = normalizedChannel.charCodeAt(0);
  const low = normalizedChannel.charCodeAt(1);
  if ((high === 0x44 || high === 0x33) && low >= 0x31 && low <= 0x39) {
    return `1${normalizedChannel[1]!}`;
  }
  if ((high === 0x45 || high === 0x34) && low >= 0x31 && low <= 0x39) {
    return `2${normalizedChannel[1]!}`;
  }
  return undefined;
}

function resolveInvisibleChannel(normalizedChannel: string): string | undefined {
  if (normalizedChannel.length !== 2) {
    return undefined;
  }
  const high = normalizedChannel.charCodeAt(0);
  const low = normalizedChannel.charCodeAt(1);
  if ((high === 0x33 || high === 0x34) && low >= 0x31 && low <= 0x39) {
    return `${high === 0x33 ? '1' : '2'}${normalizedChannel[1]!}`;
  }
  return undefined;
}

function resolveLongNoteEndBeat(
  event: BeMusicEvent,
  beat: number,
  normalizedChannel: string,
  bmsonResolution?: number,
): number | undefined {
  if (normalizedChannel === '17' || normalizedChannel === '27') {
    return beat + FREE_ZONE_BEAT_LENGTH;
  }
  if (event.bmson?.l && event.bmson.l > 0 && typeof bmsonResolution === 'number') {
    return beat + event.bmson.l / bmsonResolution;
  }
  return undefined;
}

function applyLnobjLongNotes(
  json: BeMusicJson,
  notes: WebTimedPlayableNote[],
  resolver: ReturnType<typeof createTimingResolver>,
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
    const endBeat = resolved.startToEndBeat.get(note.event);
    if (typeof endBeat === 'number' && Number.isFinite(endBeat) && endBeat > note.beat) {
      note.endBeat = endBeat;
      note.endSeconds = resolver.beatToSeconds(endBeat);
    }
    notes[writeIndex] = note;
    writeIndex += 1;
  }
  notes.length = writeIndex;
}

function appendLegacyBmsLongNotes(
  json: BeMusicJson,
  notes: WebTimedPlayableNote[],
  resolver: ReturnType<typeof createTimingResolver>,
): void {
  if (json.sourceFormat !== 'bms') {
    return;
  }
  const resolved = resolveBmsLongNotes(json, {
    inferLnTypeWhenMissing: true,
  });
  for (const longNote of resolved.notes) {
    const endBeat = typeof longNote.endBeat === 'number' && longNote.endBeat > longNote.beat ? longNote.endBeat : undefined;
    notes.push({
      event: longNote.event,
      channel: longNote.channel,
      beat: longNote.beat,
      seconds: resolver.beatToSeconds(longNote.beat),
      endBeat,
      endSeconds: endBeat !== undefined ? resolver.beatToSeconds(endBeat) : undefined,
    });
  }
}

function comparePlayableNotes(left: WebTimedPlayableNote, right: WebTimedPlayableNote): number {
  if (left.seconds !== right.seconds) {
    return left.seconds - right.seconds;
  }
  if (left.channel !== right.channel) {
    return left.channel.localeCompare(right.channel, 'en');
  }
  return left.event.value.localeCompare(right.event.value, 'en');
}

function createMeasureTimes(json: BeMusicJson, resolver: ReturnType<typeof createTimingResolver>): number[] {
  const maxMeasure = resolveMaxMeasure(json);
  const times: number[] = [];
  for (let measure = 0; measure <= maxMeasure + 1; measure += 1) {
    const seconds = resolver.beatToSeconds(resolver.beatResolver.measureToBeat(measure, 0));
    if (!Number.isFinite(seconds)) {
      continue;
    }
    if (times.length > 0 && Math.abs(times[times.length - 1]! - seconds) < 1e-6) {
      continue;
    }
    times.push(seconds);
  }
  return times;
}

function resolveDurationSeconds(
  playableNotes: ReadonlyArray<WebTimedPlayableNote>,
  landmineNotes: ReadonlyArray<WebTimedLandmineNote>,
  events: ReadonlyArray<BeMusicEvent>,
  resolver: ReturnType<typeof createTimingResolver>,
): number {
  let maxSeconds = 0;
  for (const note of playableNotes) {
    maxSeconds = Math.max(maxSeconds, note.endSeconds ?? note.seconds);
  }
  for (const note of landmineNotes) {
    maxSeconds = Math.max(maxSeconds, note.seconds);
  }
  for (const event of events) {
    maxSeconds = Math.max(maxSeconds, resolver.eventToSeconds(event));
  }
  return maxSeconds + 1.5;
}

function resolveMaxMeasure(json: BeMusicJson): number {
  let maxMeasure = 0;
  for (const event of json.events) {
    if (event.measure > maxMeasure) {
      maxMeasure = event.measure;
    }
  }
  for (const measure of json.measures) {
    if (measure.index > maxMeasure) {
      maxMeasure = measure.index;
    }
  }
  return maxMeasure;
}
