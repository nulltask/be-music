import {
  collectLnobjEndEvents,
  createBeatResolver,
  isLandmineChannel,
  isSampleTriggerChannel,
  resolveBmsLongNotes,
  sortEvents,
  type BeatResolver,
} from '../../chart/src/index.ts';
import { normalizeChannel, normalizeObjectKey, type BeMusicEvent, type BeMusicJson } from '@be-music/json';
import { createTimingResolver, type TimingResolver } from './timing.ts';

const EMPTY_EVENT_SET = new Set<BeMusicEvent>();

export interface BrowserTimedSampleTrigger {
  event: BeMusicEvent;
  beat: number;
  seconds: number;
  channel: string;
  sampleKey: string;
  samplePath?: string;
  sampleOffsetSeconds: number;
  sampleDurationSeconds?: number;
  sampleSliceId?: string;
}

export interface CollectBrowserSampleTriggersOptions {
  inferBmsLnTypeWhenMissing?: boolean;
}

export function collectBrowserSampleTriggers(
  json: BeMusicJson,
  resolver: TimingResolver = createTimingResolver(json),
  options: CollectBrowserSampleTriggersOptions = {},
): BrowserTimedSampleTrigger[] {
  const beatResolver = createBeatResolver(json);
  const sortedEvents = sortEvents(json.events);
  const isBmsChart = json.sourceFormat === 'bms';
  const lnobjEndEvents = isBmsChart ? collectLnobjEndEvents(json) : EMPTY_EVENT_SET;
  const suppressedBmsLongNoteEvents = isBmsChart
    ? resolveBmsLongNotes(json, {
        inferLnTypeWhenMissing: options.inferBmsLnTypeWhenMissing === true,
      }).suppressedTriggerEvents
    : EMPTY_EVENT_SET;

  const selectedEvents: Array<{ event: BeMusicEvent; normalizedChannel: string }> = [];
  for (const event of sortedEvents) {
    const normalizedChannel = normalizeChannel(event.channel);
    if (!isSampleTriggerChannel(normalizedChannel) || isLandmineChannel(normalizedChannel)) {
      continue;
    }
    if (lnobjEndEvents.has(event) || suppressedBmsLongNoteEvents.has(event)) {
      continue;
    }
    selectedEvents.push({ event, normalizedChannel });
  }

  const bmsonPlaybackMap =
    json.sourceFormat === 'bmson' ? createBmsonSamplePlaybackMap(json, resolver, selectedEvents.map((item) => item.event), beatResolver) : undefined;

  return selectedEvents.map(({ event, normalizedChannel }) => {
    const sampleKey = normalizeObjectKey(event.value);
    const playback = bmsonPlaybackMap?.get(event);
    const beat = beatResolver.eventToBeat(event);
    return {
      event,
      beat,
      seconds: resolver.beatToSeconds(beat),
      channel: normalizedChannel,
      sampleKey,
      samplePath: json.resources.wav[sampleKey],
      sampleOffsetSeconds: playback?.offsetSeconds ?? 0,
      sampleDurationSeconds: playback?.durationSeconds,
      sampleSliceId: playback?.sliceId,
    } satisfies BrowserTimedSampleTrigger;
  });
}

function createBmsonSamplePlaybackMap(
  json: BeMusicJson,
  resolver: TimingResolver,
  sampleEvents: BeMusicEvent[],
  beatResolver: BeatResolver,
): Map<BeMusicEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }> {
  const perSampleKey = new Map<
    string,
    Array<{ event: BeMusicEvent; beat: number; seconds: number; sampleKey: string }>
  >();

  for (const event of sampleEvents) {
    const sampleKey = normalizeObjectKey(event.value);
    const entries = perSampleKey.get(sampleKey) ?? [];
    if (!perSampleKey.has(sampleKey)) {
      perSampleKey.set(sampleKey, entries);
    }
    const beat = beatResolver.eventToBeat(event);
    entries.push({
      event,
      beat,
      seconds: resolver.beatToSeconds(beat),
      sampleKey,
    });
  }

  const playbackMap = new Map<BeMusicEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }>();
  for (const entries of perSampleKey.values()) {
    let anchorSeconds = 0;
    let hasAnchor = false;
    let sliceIndex = 0;

    for (let index = 0; index < entries.length; ) {
      const firstEntry = entries[index]!;
      const currentBeat = firstEntry.beat;
      let end = index + 1;
      let shouldRestart = firstEntry.event.bmson?.c !== true;
      while (end < entries.length && Math.abs(entries[end]!.beat - currentBeat) < 1e-9) {
        if (entries[end]!.event.bmson?.c !== true) {
          shouldRestart = true;
        }
        end += 1;
      }

      if (!hasAnchor || shouldRestart) {
        anchorSeconds = firstEntry.seconds;
        hasAnchor = true;
      }

      const offsetSeconds = Math.max(0, firstEntry.seconds - anchorSeconds);
      const next = end < entries.length ? entries[end]! : undefined;
      const durationSeconds = next ? Math.max(0, next.seconds - firstEntry.seconds) : undefined;
      const sliceId = `${firstEntry.sampleKey}:${sliceIndex}`;
      sliceIndex += 1;
      const playback = { offsetSeconds, durationSeconds, sliceId };

      for (let cursor = index; cursor < end; cursor += 1) {
        playbackMap.set(entries[cursor]!.event, playback);
      }
      index = end;
    }
  }

  return playbackMap;
}
