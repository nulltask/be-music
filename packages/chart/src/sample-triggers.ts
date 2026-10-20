import {
  normalizeChannel,
  normalizeObjectKey,
  resolveBMSBase,
  type BeMusicEvent,
  type BeMusicJSON,
} from '@be-music/json';
import {
  collectLNOBJEndEvents,
  isLandmineChannel,
  isSampleTriggerChannel,
  resolveBMSLongNotes,
  type BeatResolver,
} from './index.ts';
import {
  createTimingBuildContext,
  createTimingResolver,
  type TimingBuildContext,
  type TimingResolver,
} from './timing.ts';

export interface TimedSampleTrigger {
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

export interface CollectSampleTriggersOptions {
  inferBmsLNTypeWhenMissing?: boolean;
}

const EMPTY_EVENT_SET = new Set<BeMusicEvent>();

export function collectSampleTriggers(
  json: BeMusicJSON,
  resolver: TimingResolver = createTimingResolver(json),
  options: CollectSampleTriggersOptions = {},
): TimedSampleTrigger[] {
  return collectSampleTriggersWithContext(json, resolver, createTimingBuildContext(json), options);
}

export function collectSampleTriggersWithContext(
  json: BeMusicJSON,
  resolver: TimingResolver,
  context: TimingBuildContext,
  options: CollectSampleTriggersOptions = {},
): TimedSampleTrigger[] {
  const { sortedEvents, beatResolver } = context;
  const isBMSChart = json.sourceFormat === 'bms';
  const lnobjEndEvents = isBMSChart ? collectLNOBJEndEvents(json) : EMPTY_EVENT_SET;
  const suppressedBMSLongNoteEvents = isBMSChart
    ? resolveBMSLongNotes(json, {
        inferLNTypeWhenMissing: options.inferBmsLNTypeWhenMissing === true,
      }).suppressedTriggerEvents
    : EMPTY_EVENT_SET;
  const selectedEvents: Array<{ event: BeMusicEvent; normalizedChannel: string }> = [];
  for (const event of sortedEvents) {
    const normalizedChannel = normalizeChannel(event.channel);
    if (!isSampleTriggerChannel(normalizedChannel) || isLandmineChannel(normalizedChannel)) {
      continue;
    }
    if (lnobjEndEvents.has(event)) {
      continue;
    }
    if (suppressedBMSLongNoteEvents.has(event)) {
      continue;
    }
    selectedEvents.push({ event, normalizedChannel });
  }
  const events = selectedEvents.map((item) => item.event);
  const bmsonPlaybackMap =
    json.sourceFormat === 'bmson' ? createBmsonSamplePlaybackMap(json, resolver, events, beatResolver) : undefined;

  const idBase = resolveBMSBase(json);
  const triggers: TimedSampleTrigger[] = [];
  for (const item of selectedEvents) {
    const event = item.event;
    const sampleKey = normalizeObjectKey(event.value, idBase);
    const playback = bmsonPlaybackMap?.get(event);
    const beat = beatResolver.eventToBeat(event);
    triggers.push({
      event,
      beat,
      seconds: resolver.beatToSeconds(beat),
      channel: item.normalizedChannel,
      sampleKey,
      samplePath: json.resources.wav[sampleKey],
      sampleOffsetSeconds: playback?.offsetSeconds ?? 0,
      sampleDurationSeconds: playback?.durationSeconds,
      sampleSliceId: playback?.sliceId,
    } satisfies TimedSampleTrigger);
  }
  return triggers;
}

export function createBmsonSamplePlaybackMap(
  json: BeMusicJSON,
  resolver: TimingResolver,
  sampleEvents: BeMusicEvent[],
  beatResolver: BeatResolver,
): Map<BeMusicEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }> {
  const perSampleKey = new Map<
    string,
    Array<{ event: BeMusicEvent; beat: number; seconds: number; sampleKey: string }>
  >();
  const idBase = resolveBMSBase(json);
  for (const event of sampleEvents) {
    const sampleKey = normalizeObjectKey(event.value, idBase);
    let entries = perSampleKey.get(sampleKey);
    if (!entries) {
      entries = [];
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

    for (let index = 0; index < entries.length;) {
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
      // bmson 1.0.0 spec: a `c=true` note must NOT restart playback — the previous `c=false` anchor's audio keeps
      // streaming through it. So the slice's duration boundary is the next note that forces a restart (`c !== true`),
      // not just the next note. Walking past every consecutive `c=true` chord here means the BufferSource scheduled for
      // THIS slice plays long enough to cover them all, and the runtime's "skip retrigger when this sample is already
      // active" path actually has an active sample to compare against.
      let boundaryIndex = end;
      while (boundaryIndex < entries.length && entries[boundaryIndex]!.event.bmson?.c === true) {
        boundaryIndex += 1;
      }
      const boundary = boundaryIndex < entries.length ? entries[boundaryIndex]! : undefined;
      const durationSeconds = boundary ? Math.max(0, boundary.seconds - firstEntry.seconds) : undefined;
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
