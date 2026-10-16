import {
  normalizeChannel,
  normalizeObjectKey,
  resolveBmsBase,
  type BeMusicEvent,
  type BeMusicJson,
} from '@be-music/json';
import {
  createBeatResolver,
  normalizePositionDenominator,
  normalizePositionNumerator,
  sortEvents,
  type BeatResolver,
} from './beats.ts';
import { isPlayableNormalizedChannel, mapBmsLongNoteNormalizedChannelToPlayable } from './channels.ts';

export interface BmsLongNote {
  event: BeMusicEvent;
  sourceChannel: string;
  channel: string;
  beat: number;
  endBeat?: number;
  /**
   * The object the tail is read from: the closing object of an `#LNTYPE 1` pair, or the last object of an `#LNTYPE 2`
   * run, whose tail is one cell after it. Set together with {@link endBeat}.
   */
  endEvent?: BeMusicEvent;
}

export interface BmsLongNoteResolution {
  notes: BmsLongNote[];
  suppressedTriggerEvents: Set<BeMusicEvent>;
  /** The `#LNTYPE` the `5x` / `6x` objects were read with: the chart's own, else inferred or 1. */
  lnType: 1 | 2;
}

export interface ResolveBmsLongNotesOptions {
  inferLnTypeWhenMissing?: boolean;
}

interface ResolvedBmsLongNoteEvent {
  event: BeMusicEvent;
  sourceChannel: string;
  channel: string;
  normalizedValue: string;
}

interface NormalizedChartEvent {
  event: BeMusicEvent;
  normalizedChannel: string;
}

export function resolveBmsLongNotes(
  json: BeMusicJson,
  options: ResolveBmsLongNotesOptions = {},
): BmsLongNoteResolution {
  const declaredLnType = json.bms.lnType === 1 || json.bms.lnType === 2 ? json.bms.lnType : 1;
  if (json.sourceFormat !== 'bms') {
    return {
      notes: [],
      suppressedTriggerEvents: new Set(),
      lnType: declaredLnType,
    };
  }

  const longNoteEvents = prepareResolvedBmsLongNoteEvents(json.events, resolveBmsBase(json));
  if (longNoteEvents.length === 0) {
    return {
      notes: [],
      suppressedTriggerEvents: new Set(),
      lnType: declaredLnType,
    };
  }

  const beatResolver = createBeatResolver(json);
  const lnType = resolveBmsLongNoteType(json, longNoteEvents, options);
  const resolved =
    lnType === 2
      ? resolveBmsLongNotesType2(longNoteEvents, beatResolver)
      : resolveBmsLongNotesType1(longNoteEvents, beatResolver);
  return { ...resolved, lnType };
}

export function collectLnobjEndEvents(json: BeMusicJson): Set<BeMusicEvent> {
  return resolveLnobjLongNotes(json).endEvents;
}

export interface LnobjLongNoteResolution {
  startToEndBeat: Map<BeMusicEvent, number>;
  /** The end object each long-note start pairs with (the same pairs as {@link startToEndBeat}). */
  startToEndEvent: Map<BeMusicEvent, BeMusicEvent>;
  endEvents: Set<BeMusicEvent>;
}

export function resolveLnobjLongNotes(json: BeMusicJson): LnobjLongNoteResolution {
  if (json.sourceFormat !== 'bms') {
    return {
      startToEndBeat: new Map(),
      startToEndEvent: new Map(),
      endEvents: new Set(),
    };
  }

  const idBase = resolveBmsBase(json);
  const lnObjValues = resolveLnobjValues(json, idBase);
  if (lnObjValues.size === 0) {
    return {
      startToEndBeat: new Map(),
      startToEndEvent: new Map(),
      endEvents: new Set(),
    };
  }

  const beatResolver = createBeatResolver(json);
  const preparedEvents = prepareNormalizedChartEvents(json.events);
  const legacyLongNoteTicks = collectLegacyLongNoteTickKeysFromPreparedEvents(preparedEvents);
  const pendingStartByChannel = new Map<string, { event: BeMusicEvent; beat: number }>();
  const startToEndBeat = new Map<BeMusicEvent, number>();
  const startToEndEvent = new Map<BeMusicEvent, BeMusicEvent>();
  const endEvents = new Set<BeMusicEvent>();

  for (const item of preparedEvents) {
    const { event, normalizedChannel } = item;
    if (!isPlayableNormalizedChannel(normalizedChannel)) {
      continue;
    }
    const tickKey = createEventTickKey(event);
    if (legacyLongNoteTicks.has(`${normalizedChannel}:${tickKey}`)) {
      pendingStartByChannel.delete(normalizedChannel);
      continue;
    }

    const beat = beatResolver.eventToBeat(event);
    const normalizedValue = normalizeObjectKey(event.value, idBase);
    if (lnObjValues.has(normalizedValue)) {
      const start = pendingStartByChannel.get(normalizedChannel);
      if (start && beat > start.beat) {
        startToEndBeat.set(start.event, beat);
        startToEndEvent.set(start.event, event);
        endEvents.add(event);
      }
      pendingStartByChannel.delete(normalizedChannel);
      continue;
    }

    pendingStartByChannel.set(normalizedChannel, { event, beat });
  }

  return {
    startToEndBeat,
    startToEndEvent,
    endEvents,
  };
}

function resolveBmsLongNotesType1(
  events: ResolvedBmsLongNoteEvent[],
  beatResolver: BeatResolver,
): Omit<BmsLongNoteResolution, 'lnType'> {
  const notes: BmsLongNote[] = [];
  const suppressedTriggerEvents = new Set<BeMusicEvent>();
  const pendingByChannel = new Map<string, BmsLongNote>();

  for (const item of events) {
    const beat = beatResolver.eventToBeat(item.event);
    const pending = pendingByChannel.get(item.sourceChannel);
    if (pending && beat > pending.beat) {
      pending.endBeat = beat;
      pending.endEvent = item.event;
      suppressedTriggerEvents.add(item.event);
      pendingByChannel.delete(item.sourceChannel);
      continue;
    }
    const note: BmsLongNote = {
      event: item.event,
      sourceChannel: item.sourceChannel,
      channel: item.channel,
      beat,
    };
    notes.push(note);
    pendingByChannel.set(item.sourceChannel, note);
  }

  return { notes, suppressedTriggerEvents };
}

function resolveLnobjValues(json: BeMusicJson, base: 36 | 62 = 36): Set<string> {
  const values = new Set<string>();
  for (const candidate of json.bms.lnObjs ?? []) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      values.add(normalizeObjectKey(candidate, base));
    }
  }
  return values;
}

function prepareNormalizedChartEvents(events: ReadonlyArray<BeMusicEvent>): NormalizedChartEvent[] {
  const prepared: NormalizedChartEvent[] = [];
  for (const event of sortEvents(events as BeMusicEvent[])) {
    prepared.push({
      event,
      normalizedChannel: normalizeChannel(event.channel),
    });
  }
  return prepared;
}

function prepareResolvedBmsLongNoteEvents(
  events: ReadonlyArray<BeMusicEvent>,
  base: 36 | 62 = 36,
): ResolvedBmsLongNoteEvent[] {
  const prepared: ResolvedBmsLongNoteEvent[] = [];
  // Only the `5x` / `6x` objects are sorted, not the whole chart: the sort is stable, so they come out in the same order
  // as when picked from the sorted chart.
  const longNoteEvents = events.filter(
    (event) => mapBmsLongNoteNormalizedChannelToPlayable(normalizeChannel(event.channel)) !== undefined,
  );
  for (const event of sortEvents(longNoteEvents)) {
    const sourceChannel = normalizeChannel(event.channel);
    const mapped = mapBmsLongNoteNormalizedChannelToPlayable(sourceChannel)!;
    prepared.push({
      event,
      sourceChannel,
      channel: mapped,
      normalizedValue: normalizeObjectKey(event.value, base),
    });
  }
  return prepared;
}

function collectLegacyLongNoteTickKeysFromPreparedEvents(events: ReadonlyArray<NormalizedChartEvent>): Set<string> {
  const keys = new Set<string>();
  for (const item of events) {
    const playableChannel = mapBmsLongNoteNormalizedChannelToPlayable(item.normalizedChannel);
    if (!playableChannel) {
      continue;
    }
    keys.add(createNormalizedChannelTickKey(playableChannel, item.event));
  }
  return keys;
}

function createNormalizedChannelTickKey(normalizedChannel: string, event: BeMusicEvent): string {
  return `${normalizedChannel}:${createEventTickKey(event)}`;
}

function createEventTickKey(event: BeMusicEvent): string {
  const measure = Math.max(0, Math.floor(event.measure));
  const denominator = normalizePositionDenominator(event.position[1]);
  const numerator = normalizePositionNumerator(event.position[0], denominator);
  return `${measure}:${numerator}/${denominator}`;
}

function resolveBmsLongNotesType2(
  events: ResolvedBmsLongNoteEvent[],
  beatResolver: BeatResolver,
): Omit<BmsLongNoteResolution, 'lnType'> {
  const notes: BmsLongNote[] = [];
  const suppressedTriggerEvents = new Set<BeMusicEvent>();
  const eventsByChannel = groupResolvedLongNoteEventsBySourceChannel(events);

  for (const channelEvents of eventsByChannel.values()) {
    let runNote: BmsLongNote | undefined;
    let previousEvent: BeMusicEvent | undefined;

    for (const item of channelEvents) {
      const beat = beatResolver.eventToBeat(item.event);
      if (!runNote) {
        runNote = {
          event: item.event,
          sourceChannel: item.sourceChannel,
          channel: item.channel,
          beat,
        };
        notes.push(runNote);
        previousEvent = item.event;
        continue;
      }

      if (previousEvent && isBmsLongNoteType2Continuation(previousEvent, item.event)) {
        suppressedTriggerEvents.add(item.event);
        previousEvent = item.event;
        continue;
      }

      if (previousEvent) {
        const endBeat = resolveBmsLongNoteType2SegmentEndBeat(previousEvent, beatResolver);
        if (endBeat > runNote.beat) {
          runNote.endBeat = endBeat;
          runNote.endEvent = previousEvent;
        }
      }
      runNote = {
        event: item.event,
        sourceChannel: item.sourceChannel,
        channel: item.channel,
        beat,
      };
      notes.push(runNote);
      previousEvent = item.event;
    }

    if (runNote && previousEvent) {
      const endBeat = resolveBmsLongNoteType2SegmentEndBeat(previousEvent, beatResolver);
      if (endBeat > runNote.beat) {
        runNote.endBeat = endBeat;
        runNote.endEvent = previousEvent;
      }
    }
  }

  notes.sort((left, right) => {
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

  return { notes, suppressedTriggerEvents };
}

function resolveBmsLongNoteType(
  json: BeMusicJson,
  events: ResolvedBmsLongNoteEvent[],
  options: ResolveBmsLongNotesOptions,
): 1 | 2 {
  if (json.bms.lnType === 1 || json.bms.lnType === 2) {
    return json.bms.lnType;
  }
  if (options.inferLnTypeWhenMissing !== true) {
    return 1;
  }
  return inferBmsLongNoteType(events);
}

function inferBmsLongNoteType(events: ResolvedBmsLongNoteEvent[]): 1 | 2 {
  for (const channelEvents of groupResolvedLongNoteEventsBySourceChannel(events).values()) {
    let previous: BeMusicEvent | undefined;
    let previousValue: string | undefined;
    let continuationCount = 0;
    for (const item of channelEvents) {
      if (previous && previousValue === item.normalizedValue && isBmsLongNoteType2Continuation(previous, item.event)) {
        // A single same-value continuation is ambiguous because legacy LNTYPE=1 charts also use same-value pairs for
        // their start/end markers.
        continuationCount += 1;
        if (continuationCount >= 2) {
          return 2;
        }
      } else {
        continuationCount = 0;
      }
      previous = item.event;
      previousValue = item.normalizedValue;
    }
  }

  return 1;
}

function groupResolvedLongNoteEventsBySourceChannel(
  events: ReadonlyArray<ResolvedBmsLongNoteEvent>,
): Map<string, ResolvedBmsLongNoteEvent[]> {
  const grouped = new Map<string, ResolvedBmsLongNoteEvent[]>();
  for (const item of events) {
    const bucket = grouped.get(item.sourceChannel);
    if (bucket) {
      bucket.push(item);
      continue;
    }
    grouped.set(item.sourceChannel, [item]);
  }
  return grouped;
}

function isBmsLongNoteType2Continuation(previous: BeMusicEvent, current: BeMusicEvent): boolean {
  if (current.measure === previous.measure) {
    return (
      current.position[1] === previous.position[1] &&
      normalizePositionNumerator(current.position[0], normalizePositionDenominator(current.position[1])) ===
        normalizePositionNumerator(previous.position[0], normalizePositionDenominator(previous.position[1])) + 1
    );
  }

  if (current.measure !== previous.measure + 1) {
    return false;
  }

  const previousDenominator = normalizePositionDenominator(previous.position[1]);
  const previousNumerator = normalizePositionNumerator(previous.position[0], previousDenominator);
  const currentDenominator = normalizePositionDenominator(current.position[1]);
  const currentNumerator = normalizePositionNumerator(current.position[0], currentDenominator);

  return previousNumerator + 1 === previousDenominator && currentNumerator === 0;
}

function resolveBmsLongNoteType2SegmentEndBeat(event: BeMusicEvent, beatResolver: BeatResolver): number {
  const measure = Math.max(0, Math.floor(event.measure));
  const denominator = normalizePositionDenominator(event.position[1]);
  const numerator = normalizePositionNumerator(event.position[0], denominator);
  const nextNumerator = numerator + 1;
  if (nextNumerator >= denominator) {
    return beatResolver.measureToBeat(measure + 1, 0);
  }
  return beatResolver.measureToBeat(measure, nextNumerator / denominator);
}
