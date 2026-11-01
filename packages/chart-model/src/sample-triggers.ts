import {
  normalizeChannel,
  normalizeObjectKey,
  resolveBMSBase,
  type BeMusicEvent,
  type BeMusicJSON,
} from '@be-music/chart-source';
import {
  collectLNOBJEndEvents,
  isLandmineChannel,
  isSampleTriggerChannel,
  resolveBMSLongNotes,
  type BeatResolver,
} from './index.ts';
import { resolveJudgedNotes } from './resolved-notes.ts';
import { resolveChartPlayVariant } from './play-variant.ts';
import { resolveBmsWAVResources } from './wav-directives.ts';
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

/**
 * The chart's effective WAV resources ({@link resolveBmsWAVResources}) that some sample event names: a BGM, note,
 * invisible note or long-note object, whatever becomes of it in play. Slots only declared, or named only by landmines
 * (whose value is damage) or by `#WAVCMD` / `#EXWAV` tweaks, are left out, so a player need not decode them.
 */
export function resolveReferencedBmsWAVResources(json: BeMusicJSON): Record<string, string> {
  const base = resolveBMSBase(json);
  const longKeys = json.sourceFormat === 'bmson';
  const referenced = new Set<string>();
  for (const event of json.events) {
    const channel = normalizeChannel(event.channel);
    if (!isSampleTriggerChannel(channel) || isLandmineChannel(channel)) continue;
    referenced.add(normalizeObjectKey(event.value, base, longKeys));
  }
  const resources: Record<string, string> = {};
  for (const [key, path] of Object.entries(resolveBmsWAVResources(json))) {
    if (referenced.has(normalizeObjectKey(key, base, longKeys))) resources[key] = path;
  }
  return resources;
}

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
  const wavResources = resolveBmsWAVResources(json);
  // Keep every up entry in the slicing pass, but only an attached LN-end sample is audible on a playable lane. A note
  // of another length stacked on a bmson note is dropped with its sound, so it is not audible either.
  const hasUp = json.sourceFormat === 'bmson' && events.some((event) => event.bmson?.up === true);
  const judged =
    hasUp || (json.sourceFormat === 'bmson' && hasStackedLaneEvents(selectedEvents, beatResolver))
      ? resolveJudgedNotes({
          json,
          timing: resolver,
          beatResolver,
          sortedEvents,
          idBase,
          resolvePlayVariant: () => resolveChartPlayVariant(json),
          inferBmsLNTypeWhenMissing: options.inferBmsLNTypeWhenMissing === true,
        })
      : undefined;
  const endSounds = hasUp
    ? new Set(judged!.notes.flatMap((note) => (note.endSoundEvent ? [note.endSoundEvent] : [])))
    : undefined;
  const layeredEvents = new Set(judged?.notes.flatMap((note) => note.soundEvents ?? []));
  const droppedEvents = new Set(
    judged?.shadowedNotes.map((note) => note.event).filter((event) => !layeredEvents.has(event)),
  );
  const triggers: TimedSampleTrigger[] = [];
  for (const item of selectedEvents) {
    const event = item.event;
    if (endSounds && item.normalizedChannel !== '01' && event.bmson?.up === true && !endSounds.has(event)) continue;
    if (droppedEvents.has(event)) continue;
    const sampleKey = normalizeObjectKey(event.value, idBase, json.sourceFormat === 'bmson');
    const playback = bmsonPlaybackMap?.get(event);
    const beat = beatResolver.eventToBeat(event);
    triggers.push({
      event,
      beat,
      seconds: resolver.beatToSeconds(beat),
      channel: item.normalizedChannel,
      sampleKey,
      samplePath: wavResources[sampleKey],
      sampleOffsetSeconds: playback?.offsetSeconds ?? 0,
      sampleDurationSeconds: playback?.durationSeconds,
      sampleSliceId: playback?.sliceId,
    } satisfies TimedSampleTrigger);
  }
  return triggers;
}

/** Whether two playable-lane events share a lane and beat, the only case where a bmson note can be dropped. */
function hasStackedLaneEvents(
  items: ReadonlyArray<{ event: BeMusicEvent; normalizedChannel: string }>,
  beatResolver: BeatResolver,
): boolean {
  const seen = new Set<string>();
  for (const { event, normalizedChannel } of items) {
    const side = normalizedChannel.charCodeAt(0);
    if (side !== 0x31 && side !== 0x32) continue;
    const key = `${normalizedChannel}:${beatResolver.eventToBeat(event)}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
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
    const sampleKey = normalizeObjectKey(event.value, idBase, json.sourceFormat === 'bmson');
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
    // Hosts can concatenate playable and BGM lists; source order must not change slice boundaries.
    entries.sort((left, right) => left.beat - right.beat);
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
      // Every distinct pulse cuts the stem. `c` chooses the source offset, not whether the next note needs a trigger.
      const boundary = entries[end];
      const durationSeconds = boundary ? Math.max(0, boundary.seconds - firstEntry.seconds) : undefined;
      const sliceId = `${firstEntry.sampleKey}:${sliceIndex}`;
      sliceIndex += 1;
      const playback = {
        offsetSeconds: firstEntry.event.bmson?.sampleOffsetSeconds ?? offsetSeconds,
        durationSeconds:
          firstEntry.event.bmson?.sampleOffsetSeconds !== undefined
            ? firstEntry.event.bmson.sampleDurationSeconds
            : durationSeconds,
        sliceId,
      };

      for (let cursor = index; cursor < end; cursor += 1) {
        playbackMap.set(entries[cursor]!.event, playback);
      }
      index = end;
    }
  }

  return playbackMap;
}
