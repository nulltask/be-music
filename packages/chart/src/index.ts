import {
  normalizeChannel,
  normalizeObjectKey,
  type BeMusicEvent,
  type BeMusicJson,
} from '@be-music/json';

export interface BeatResolver {
  measureToBeat: (measure: number, position?: number) => number;
  eventToBeat: (event: BeMusicEvent) => number;
}

const BMS_LONG_NOTE_PLAYABLE_1P = ['11', '12', '13', '14', '15', '16', '17', '18', '19'] as const;
const BMS_LONG_NOTE_PLAYABLE_2P = ['21', '22', '23', '24', '25', '26', '27', '28', '29'] as const;
const PACKED_CHANNEL_01 = 0x3031;
const PACKED_CHANNEL_03 = 0x3033;
const PACKED_CHANNEL_08 = 0x3038;
const PACKED_CHANNEL_09 = 0x3039;
const PACKED_CHANNEL_97 = 0x3937;
const PACKED_CHANNEL_98 = 0x3938;
const PACKED_CHANNEL_SC = 0x5343;
const PACKED_CHANNEL_SP = 0x5350;

export function parseBpmFrom03Token(value: string): number {
  if (value.length === 2) {
    const high = parseHexDigitFast(value.charCodeAt(0));
    const low = parseHexDigitFast(value.charCodeAt(1));
    if (high >= 0 && low >= 0) {
      return (high << 4) + low;
    }
  }
  const parsed = Number.parseInt(value, 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getMeasureBeats(length: number): number {
  return 4 * length;
}

export function measureToBeat(json: BeMusicJson, measure: number, position = 0): number {
  const safeMeasure = Math.max(0, Math.floor(measure));
  if (json.measures.length === 0) {
    return safeMeasure * 4 + 4 * clamp01(position);
  }
  const safePosition = clamp01(position);
  const measureLengths = createExactMeasureLengthRecord(json);
  let beats = 0;
  for (let current = 0; current < safeMeasure; current += 1) {
    beats += getMeasureBeats(measureLengths[current] ?? 1);
  }
  beats += getMeasureBeats(measureLengths[safeMeasure] ?? 1) * safePosition;
  return beats;
}

export function eventToBeat(json: BeMusicJson, event: BeMusicEvent): number {
  if (json.measures.length === 0) {
    const measure = Math.max(0, Math.floor(event.measure));
    const denominator = normalizePositionDenominator(event.position[1]);
    const numerator = normalizePositionNumerator(event.position[0], denominator);
    return measure * 4 + (4 * numerator) / denominator;
  }
  return measureToBeat(json, event.measure, getEventPosition(event));
}

export function createBeatResolver(json: BeMusicJson): BeatResolver {
  if (json.measures.length === 0) {
    return {
      measureToBeat: (measure, position = 0) => {
        const safeMeasure = Math.max(0, Math.floor(measure));
        return safeMeasure * 4 + 4 * clamp01(position);
      },
      eventToBeat: (event) => {
        const safeMeasure = Math.max(0, Math.floor(event.measure));
        const denominator = normalizePositionDenominator(event.position[1]);
        const numerator = normalizePositionNumerator(event.position[0], denominator);
        return safeMeasure * 4 + (4 * numerator) / denominator;
      },
    };
  }

  const measureLengths: number[] = [];
  let maxDefinedMeasure = -1;
  for (const measure of json.measures) {
    const normalizedIndex = Math.max(0, Math.floor(measure.index));
    const normalizedLength = Number.isFinite(measure.length) && measure.length > 0 ? measure.length : 1;
    measureLengths[normalizedIndex] = normalizedLength;
    if (normalizedIndex > maxDefinedMeasure) {
      maxDefinedMeasure = normalizedIndex;
    }
  }

  const measureStartBeats: number[] = [];
  let cumulativeBeats = 0;
  for (let measure = 0; measure <= maxDefinedMeasure; measure += 1) {
    measureStartBeats[measure] = cumulativeBeats;
    cumulativeBeats += getMeasureBeats(measureLengths[measure] ?? 1);
  }
  const denseLimit = maxDefinedMeasure + 1;

  const resolveMeasureStartBeat = (measure: number): number => {
    if (measure <= 0) {
      return 0;
    }
    if (measure < denseLimit) {
      return measureStartBeats[measure] ?? 0;
    }
    return cumulativeBeats + (measure - denseLimit) * 4;
  };

  const resolveMeasureLength = (measure: number): number => (measure < denseLimit ? (measureLengths[measure] ?? 1) : 1);

  return {
    measureToBeat: (measure, position = 0) => {
      const safeMeasure = Math.max(0, Math.floor(measure));
      const safePosition = clamp01(position);
      const start = resolveMeasureStartBeat(safeMeasure);
      const measureBeats = getMeasureBeats(resolveMeasureLength(safeMeasure));
      return start + measureBeats * safePosition;
    },
    eventToBeat: (event) => {
      const safeMeasure = Math.max(0, Math.floor(event.measure));
      const start = resolveMeasureStartBeat(safeMeasure);
      const measureBeats = getMeasureBeats(resolveMeasureLength(safeMeasure));
      return start + measureBeats * getEventPosition(event);
    },
  };
}

export function sortEvents(events: BeMusicEvent[]): BeMusicEvent[] {
  if (events.length <= 1) {
    return [...events];
  }

  let sorted = true;
  for (let index = 1; index < events.length; index += 1) {
    if (compareEvents(events[index - 1]!, events[index]!) > 0) {
      sorted = false;
      break;
    }
  }
  if (sorted) {
    return [...events];
  }
  return [...events].sort(compareEvents);
}

export function compareEvents(left: BeMusicEvent, right: BeMusicEvent): number {
  if (left.measure !== right.measure) {
    return left.measure - right.measure;
  }
  const leftDenominator = normalizePositionDenominator(left.position[1]);
  const leftNumerator = normalizePositionNumerator(left.position[0], leftDenominator);
  const rightDenominator = normalizePositionDenominator(right.position[1]);
  const rightNumerator = normalizePositionNumerator(right.position[0], rightDenominator);
  if (leftDenominator === rightDenominator) {
    const numeratorDelta = leftNumerator - rightNumerator;
    if (numeratorDelta !== 0) {
      return numeratorDelta;
    }
  } else {
    const leftScaled = leftNumerator * rightDenominator;
    const rightScaled = rightNumerator * leftDenominator;
    if (Number.isSafeInteger(leftScaled) && Number.isSafeInteger(rightScaled)) {
      if (leftScaled < rightScaled) {
        return -1;
      }
      if (leftScaled > rightScaled) {
        return 1;
      }
    } else {
      const leftScaledBigInt = BigInt(leftNumerator) * BigInt(rightDenominator);
      const rightScaledBigInt = BigInt(rightNumerator) * BigInt(leftDenominator);
      if (leftScaledBigInt < rightScaledBigInt) {
        return -1;
      }
      if (leftScaledBigInt > rightScaledBigInt) {
        return 1;
      }
    }
  }
  if (left.channel !== right.channel) {
    return left.channel < right.channel ? -1 : 1;
  }
  if (left.value !== right.value) {
    return left.value < right.value ? -1 : 1;
  }
  return 0;
}

export function isTempoChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0);
    const low = channel.charCodeAt(1);
    if (high === 0x30 && (low === 0x33 || low === 0x38)) {
      return true;
    }
  }
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return packed === PACKED_CHANNEL_03 || packed === PACKED_CHANNEL_08;
  }
  return isTempoNormalizedChannel(resolveNormalizedChannelForPredicate(channel));
}

export function isStopChannel(channel: string): boolean {
  if (channel.length === 2 && channel.charCodeAt(0) === 0x30 && channel.charCodeAt(1) === 0x39) {
    return true;
  }
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return packed === PACKED_CHANNEL_09;
  }
  return isStopNormalizedChannel(resolveNormalizedChannelForPredicate(channel));
}

export function isScrollChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0) & 0xdf;
    const low = channel.charCodeAt(1) & 0xdf;
    if (high === 0x53 && low === 0x43) {
      return true;
    }
  }
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return packed === PACKED_CHANNEL_SC;
  }
  return isScrollNormalizedChannel(resolveNormalizedChannelForPredicate(channel));
}

export function isLandmineChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0) & 0xdf;
    const low = channel.charCodeAt(1);
    if ((high === 0x44 || high === 0x45) && low >= 0x31 && low <= 0x39) {
      return true;
    }
  }
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return isPackedLandmineChannel(packed);
  }
  return isLandmineNormalizedChannel(resolveNormalizedChannelForPredicate(channel));
}

export function isSampleTriggerChannel(channel: string): boolean {
  if (channel.length === 2) {
    const highCode = channel.charCodeAt(0);
    const lowCode = channel.charCodeAt(1);
    if (highCode === 0x30) {
      return lowCode === 0x31;
    }
    if (highCode === 0x39 && (lowCode === 0x37 || lowCode === 0x38)) {
      return false;
    }
    if ((highCode & 0xdf) === 0x41 && lowCode === 0x30) {
      return false;
    }
    if ((highCode & 0xdf) === 0x53 && (lowCode & 0xdf) === 0x43) {
      return false;
    }
    if ((highCode & 0xdf) === 0x53 && (lowCode & 0xdf) === 0x50) {
      return false;
    }
    return true;
  }
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return isPackedSampleTriggerChannel(packed);
  }
  return isSampleTriggerNormalizedChannel(resolveNormalizedChannelForPredicate(channel));
}

export function isPlayableChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0);
    const low = channel.charCodeAt(1);
    if ((high === 0x31 || high === 0x32) && low >= 0x31 && low <= 0x39) {
      return true;
    }
  }
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return isPackedPlayableChannel(packed);
  }
  return isPlayableNormalizedChannel(resolveNormalizedChannelForPredicate(channel));
}

export function isBmsLongNoteChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0);
    const low = channel.charCodeAt(1);
    if ((high === 0x35 || high === 0x36) && low >= 0x31 && low <= 0x39) {
      return true;
    }
  }
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return isPackedBmsLongNoteChannel(packed);
  }
  return isBmsLongNoteNormalizedChannel(resolveNormalizedChannelForPredicate(channel));
}

export function isPlayLaneSoundChannel(channel: string): boolean {
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return isPackedPlayLaneSoundChannel(packed);
  }
  return isPlayLaneSoundNormalizedChannel(resolveNormalizedChannelForPredicate(channel));
}

export function isBmsBgmVolumeChangeChannel(channel: string): boolean {
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return packed === PACKED_CHANNEL_97;
  }
  return resolveNormalizedChannelForPredicate(channel) === '97';
}

export function isBmsKeyVolumeChangeChannel(channel: string): boolean {
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return packed === PACKED_CHANNEL_98;
  }
  return resolveNormalizedChannelForPredicate(channel) === '98';
}

export function isBmsDynamicVolumeChangeChannel(channel: string): boolean {
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return packed === PACKED_CHANNEL_97 || packed === PACKED_CHANNEL_98;
  }
  const normalized = resolveNormalizedChannelForPredicate(channel);
  return normalized === '97' || normalized === '98';
}

export function parseBmsDynamicVolumeGain(value: string): number | undefined {
  const normalized = normalizeObjectKey(value);
  const high = parseHexDigitFast(normalized.charCodeAt(0));
  const low = parseHexDigitFast(normalized.charCodeAt(1));
  if (high < 0 || low < 0) {
    return undefined;
  }
  const parsed = (high << 4) | low;
  if (parsed <= 0) {
    return undefined;
  }
  return parsed / 0xff;
}

export function mapBmsLongNoteChannelToPlayable(channel: string): string | undefined {
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    if (!isPackedBmsLongNoteChannel(packed)) {
      return undefined;
    }
    const low = packed & 0xff;
    const laneIndex = low - 0x31;
    return ((packed >> 8) & 0xff) === 0x35 ? BMS_LONG_NOTE_PLAYABLE_1P[laneIndex] : BMS_LONG_NOTE_PLAYABLE_2P[laneIndex];
  }
  return mapBmsLongNoteNormalizedChannelToPlayable(resolveNormalizedChannelForPredicate(channel));
}

export interface BmsLongNote {
  event: BeMusicEvent;
  sourceChannel: string;
  channel: string;
  beat: number;
  endBeat?: number;
}

export interface BmsLongNoteResolution {
  notes: BmsLongNote[];
  suppressedTriggerEvents: Set<BeMusicEvent>;
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
  if (json.sourceFormat !== 'bms') {
    return {
      notes: [],
      suppressedTriggerEvents: new Set(),
    };
  }

  const longNoteEvents = prepareResolvedBmsLongNoteEvents(json.events);
  if (longNoteEvents.length === 0) {
    return {
      notes: [],
      suppressedTriggerEvents: new Set(),
    };
  }

  const beatResolver = createBeatResolver(json);
  const lnType = resolveBmsLongNoteType(json, longNoteEvents, options);
  return lnType === 2
    ? resolveBmsLongNotesType2(longNoteEvents, beatResolver)
    : resolveBmsLongNotesType1(longNoteEvents, beatResolver);
}

export function collectLnobjEndEvents(json: BeMusicJson): Set<BeMusicEvent> {
  return resolveLnobjLongNotes(json).endEvents;
}

export interface LnobjLongNoteResolution {
  startToEndBeat: Map<BeMusicEvent, number>;
  endEvents: Set<BeMusicEvent>;
}

export function resolveLnobjLongNotes(json: BeMusicJson): LnobjLongNoteResolution {
  if (json.sourceFormat !== 'bms') {
    return {
      startToEndBeat: new Map(),
      endEvents: new Set(),
    };
  }

  const lnObjValues = resolveLnobjValues(json);
  if (lnObjValues.size === 0) {
    return {
      startToEndBeat: new Map(),
      endEvents: new Set(),
    };
  }

  const beatResolver = createBeatResolver(json);
  const preparedEvents = prepareNormalizedChartEvents(json.events);
  const legacyLongNoteTicks = collectLegacyLongNoteTickKeysFromPreparedEvents(preparedEvents);
  const pendingStartByChannel = new Map<string, { event: BeMusicEvent; beat: number }>();
  const startToEndBeat = new Map<BeMusicEvent, number>();
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
    const normalizedValue = normalizeObjectKey(event.value);
    if (lnObjValues.has(normalizedValue)) {
      const start = pendingStartByChannel.get(normalizedChannel);
      if (start && beat > start.beat) {
        startToEndBeat.set(start.event, beat);
        endEvents.add(event);
      }
      pendingStartByChannel.delete(normalizedChannel);
      continue;
    }

    pendingStartByChannel.set(normalizedChannel, { event, beat });
  }

  return {
    startToEndBeat,
    endEvents,
  };
}

function resolveBmsLongNotesType1(
  events: ResolvedBmsLongNoteEvent[],
  beatResolver: BeatResolver,
): BmsLongNoteResolution {
  const notes: BmsLongNote[] = [];
  const suppressedTriggerEvents = new Set<BeMusicEvent>();
  const pendingByChannel = new Map<string, BmsLongNote>();

  for (const item of events) {
    const beat = beatResolver.eventToBeat(item.event);
    const pending = pendingByChannel.get(item.sourceChannel);
    if (pending && beat > pending.beat) {
      pending.endBeat = beat;
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

function resolveLnobjValues(json: BeMusicJson): Set<string> {
  const values = new Set<string>();
  for (const candidate of json.bms.lnObjs ?? []) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      values.add(normalizeObjectKey(candidate));
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

function prepareResolvedBmsLongNoteEvents(events: ReadonlyArray<BeMusicEvent>): ResolvedBmsLongNoteEvent[] {
  const prepared: ResolvedBmsLongNoteEvent[] = [];
  for (const event of sortEvents(events as BeMusicEvent[])) {
    const sourceChannel = normalizeChannel(event.channel);
    const mapped = mapBmsLongNoteNormalizedChannelToPlayable(sourceChannel);
    if (!mapped) {
      continue;
    }
    prepared.push({
      event,
      sourceChannel,
      channel: mapped,
      normalizedValue: normalizeObjectKey(event.value),
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
): BmsLongNoteResolution {
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
      if (
        previous &&
        previousValue === item.normalizedValue &&
        isBmsLongNoteType2Continuation(previous, item.event)
      ) {
        // A single same-value continuation is ambiguous because legacy LNTYPE=1
        // charts also use same-value pairs for their start/end markers.
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

function createExactMeasureLengthRecord(json: BeMusicJson): Record<number, number> {
  const measureLengths: number[] = [];
  for (const measure of json.measures) {
    measureLengths[measure.index] = measure.length;
  }
  return measureLengths;
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value >= 1) {
    return 0.999999999;
  }
  return value;
}

function getEventPosition(event: BeMusicEvent): number {
  const denominator = normalizePositionDenominator(event.position[1]);
  const numerator = normalizePositionNumerator(event.position[0], denominator);
  return numerator / denominator;
}

function normalizePositionDenominator(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function normalizePositionNumerator(value: number, denominator: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = Math.floor(value);
  return Math.max(0, Math.min(denominator - 1, normalized));
}

function parseHexDigitFast(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code - 0x30;
  }
  const uppercase = code & 0xdf;
  if (uppercase >= 0x41 && uppercase <= 0x46) {
    return uppercase - 0x41 + 10;
  }
  return -1;
}

function resolveNormalizedChannelForPredicate(channel: string): string {
  if (channel.length === 2) {
    const code0 = channel.charCodeAt(0);
    const code1 = channel.charCodeAt(1);
    if (isNormalizedBase36Code(code0) && isNormalizedBase36Code(code1)) {
      return channel;
    }
  }
  return normalizeChannel(channel);
}

function isNormalizedBase36Code(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a);
}

function tryPackChannel(channel: string): number {
  if (channel.length !== 2) {
    return -1;
  }
  const sourceHigh = channel.charCodeAt(0);
  const sourceLow = channel.charCodeAt(1);
  if (isNormalizedBase36Code(sourceHigh) && isNormalizedBase36Code(sourceLow)) {
    return (sourceHigh << 8) | sourceLow;
  }
  const high = normalizeAsciiBase36CodeFast(sourceHigh);
  const low = normalizeAsciiBase36CodeFast(sourceLow);
  if (high < 0 || low < 0) {
    return -1;
  }
  return (high << 8) | low;
}

function normalizeAsciiBase36CodeFast(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code;
  }
  const uppercase = code & 0xdf;
  if (uppercase >= 0x41 && uppercase <= 0x5a) {
    return uppercase;
  }
  return -1;
}

function isTempoNormalizedChannel(normalized: string): boolean {
  return normalized === '03' || normalized === '08';
}

function isStopNormalizedChannel(normalized: string): boolean {
  return normalized === '09';
}

function isScrollNormalizedChannel(normalized: string): boolean {
  return normalized === 'SC';
}

function isLandmineNormalizedChannel(normalized: string): boolean {
  return /^[DE][1-9]$/.test(normalized);
}

function isSampleTriggerNormalizedChannel(normalized: string): boolean {
  if (/^0[0-9A-Z]$/.test(normalized)) {
    return normalized === '01';
  }
  return normalized !== '97' && normalized !== '98' && normalized !== 'A0' && normalized !== 'SC' && normalized !== 'SP';
}

function isPlayableNormalizedChannel(normalized: string): boolean {
  return /^[12][1-9]$/.test(normalized);
}

function isBmsLongNoteNormalizedChannel(normalized: string): boolean {
  return /^[56][1-9]$/.test(normalized);
}

function isPlayLaneSoundNormalizedChannel(normalized: string): boolean {
  return /^[1-6][1-9]$/.test(normalized);
}

function mapBmsLongNoteNormalizedChannelToPlayable(normalized: string): string | undefined {
  if (!isBmsLongNoteNormalizedChannel(normalized)) {
    return undefined;
  }
  const laneIndex = normalized.charCodeAt(1) - 0x31;
  return normalized.charCodeAt(0) === 0x35
    ? BMS_LONG_NOTE_PLAYABLE_1P[laneIndex]
    : BMS_LONG_NOTE_PLAYABLE_2P[laneIndex];
}

function isPackedLandmineChannel(packed: number): boolean {
  const high = (packed >> 8) & 0xff;
  const low = packed & 0xff;
  return (high === 0x44 || high === 0x45) && low >= 0x31 && low <= 0x39;
}

function isPackedSampleTriggerChannel(packed: number): boolean {
  if (((packed >> 8) & 0xff) === 0x30) {
    return (packed & 0xff) === 0x31;
  }
  if (packed === PACKED_CHANNEL_97 || packed === PACKED_CHANNEL_98 || packed === PACKED_CHANNEL_SC || packed === PACKED_CHANNEL_SP) {
    return false;
  }
  return packed !== 0x4130;
}

function isPackedPlayableChannel(packed: number): boolean {
  const high = (packed >> 8) & 0xff;
  const low = packed & 0xff;
  return (high === 0x31 || high === 0x32) && low >= 0x31 && low <= 0x39;
}

function isPackedBmsLongNoteChannel(packed: number): boolean {
  const high = (packed >> 8) & 0xff;
  const low = packed & 0xff;
  return (high === 0x35 || high === 0x36) && low >= 0x31 && low <= 0x39;
}

function isPackedPlayLaneSoundChannel(packed: number): boolean {
  const high = (packed >> 8) & 0xff;
  const low = packed & 0xff;
  return high >= 0x31 && high <= 0x36 && low >= 0x31 && low <= 0x39;
}
