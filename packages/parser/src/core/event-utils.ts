import { compareEvents } from '@be-music/chart';
import {
  normalizeChannel,
  normalizeObjectKey,
  type BeMusicEvent,
  type BeMusicJson,
  type BeMusicPosition,
} from '@be-music/json';
import {
  normalizeAsciiBase36Code,
  normalizeFractionNumerator,
  normalizeNonNegativeInt,
  normalizePositiveInt,
} from '@be-music/utils';

type MeasureLengthEntry = BeMusicJson['measures'][number];

export function normalizeBmsonNoteLength(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

export function collectNonZeroObjectTokens(input: string): {
  tokenCount: number;
  tokens: Array<{ index: number; value: string }>;
} {
  // BMS object positions need the total token count (denominator), but only non-zero tokens become events.
  const tokens: Array<{ index: number; value: string }> = [];
  let tokenCount = 0;
  let highCode = -1;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    const normalizedCode = normalizeAsciiBase36Code(code);
    if (normalizedCode < 0) {
      continue;
    }
    if (highCode < 0) {
      highCode = normalizedCode;
      continue;
    }
    if (!(highCode === 0x30 && normalizedCode === 0x30)) {
      tokens.push({
        index: tokenCount,
        value: String.fromCharCode(highCode, normalizedCode),
      });
    }
    tokenCount += 1;
    highCode = -1;
  }
  return { tokenCount, tokens };
}

export function collectNonZeroObjectEvents(measure: number, channel: string, input: string): BeMusicEvent[] {
  const events: BeMusicEvent[] = [];
  let tokenCount = 0;
  let highCode = -1;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    const normalizedCode = normalizeAsciiBase36Code(code);
    if (normalizedCode < 0) {
      continue;
    }
    if (highCode < 0) {
      highCode = normalizedCode;
      continue;
    }
    if (!(highCode === 0x30 && normalizedCode === 0x30)) {
      events.push({
        measure,
        channel,
        position: [tokenCount, 0],
        value: String.fromCharCode(highCode, normalizedCode),
      });
    }
    tokenCount += 1;
    highCode = -1;
  }

  if (tokenCount > 0) {
    for (let index = 0; index < events.length; index += 1) {
      (events[index]!.position as [number, number])[1] = tokenCount;
    }
  }

  return events;
}

export function cloneEvent(event: BeMusicEvent): BeMusicEvent {
  const cloned: BeMusicEvent = {
    measure: event.measure,
    channel: event.channel,
    position: [event.position[0], event.position[1]],
    value: event.value,
  };
  if (event.bmson) {
    cloned.bmson = {};
    if (typeof event.bmson.l === 'number') {
      cloned.bmson.l = event.bmson.l;
    }
    if (typeof event.bmson.c === 'boolean') {
      cloned.bmson.c = event.bmson.c;
    }
  }
  return cloned;
}

export function cloneEvents(events: readonly BeMusicEvent[]): BeMusicEvent[] {
  const cloned = new Array<BeMusicEvent>(events.length);
  for (let index = 0; index < events.length; index += 1) {
    cloned[index] = cloneEvent(events[index]!);
  }
  return cloned;
}

export function sortAndNormalizeEvents(events: Array<BeMusicEvent | Record<string, unknown>>): BeMusicEvent[] {
  const normalized: BeMusicEvent[] = [];
  for (const event of events) {
    const parsed = normalizeRawEvent(event);
    if (parsed) {
      normalized.push(parsed);
    }
  }

  normalized.sort(compareEvents);
  return normalized;
}

export function sortNormalizedEvents(events: BeMusicEvent[]): BeMusicEvent[] {
  events.sort(compareNormalizedEvents);
  return events;
}

export function upsertMeasureLength(
  json: BeMusicJson,
  measure: number,
  length: number,
  measureByIndex?: Map<number, MeasureLengthEntry>,
): void {
  const cached = measureByIndex?.get(measure);
  if (cached) {
    cached.length = length;
    return;
  }
  if (measureByIndex) {
    const created = { index: measure, length };
    json.measures.push(created);
    measureByIndex.set(measure, created);
    return;
  }
  const found = json.measures.find((item) => item.index === measure);
  if (found) {
    found.length = length;
  } else {
    json.measures.push({ index: measure, length });
  }
}

function normalizeRawEvent(event: BeMusicEvent | Record<string, unknown>): BeMusicEvent | undefined {
  const raw = event as Record<string, unknown>;
  const measure = normalizeMeasure(raw.measure);
  const channel = normalizeEventChannel(raw.channel);
  const value = normalizeEventValue(raw.value);
  const position = normalizePosition(raw.position);
  if (measure === undefined || channel === undefined || value === undefined || position === undefined) {
    return undefined;
  }
  const bmson = normalizeEventBmsonExtension(raw.bmson);
  return {
    measure,
    channel,
    position,
    value,
    ...(bmson ? { bmson } : {}),
  };
}

export function compareNormalizedEvents(left: BeMusicEvent, right: BeMusicEvent): number {
  if (left.measure !== right.measure) {
    return left.measure - right.measure;
  }

  const leftPosition = left.position;
  const rightPosition = right.position;
  if (leftPosition[1] === rightPosition[1]) {
    const numeratorDelta = leftPosition[0] - rightPosition[0];
    if (numeratorDelta !== 0) {
      return numeratorDelta;
    }
  } else {
    const leftScaled = leftPosition[0] * rightPosition[1];
    const rightScaled = rightPosition[0] * leftPosition[1];
    if (Number.isSafeInteger(leftScaled) && Number.isSafeInteger(rightScaled)) {
      if (leftScaled < rightScaled) {
        return -1;
      }
      if (leftScaled > rightScaled) {
        return 1;
      }
    } else {
      const leftScaledBigInt = BigInt(leftPosition[0]) * BigInt(rightPosition[1]);
      const rightScaledBigInt = BigInt(rightPosition[0]) * BigInt(leftPosition[1]);
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

function normalizeMeasure(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return normalizeNonNegativeInt(value);
}

function normalizeEventChannel(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return normalizeChannel(value);
}

function normalizeEventValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return normalizeObjectKey(value);
}

function normalizePosition(position: unknown): BeMusicPosition | undefined {
  if (!Array.isArray(position) || position.length < 2) {
    return undefined;
  }
  const denominator = normalizePositionDenominator(position[1]);
  if (denominator === undefined) {
    return undefined;
  }
  const numerator = normalizePositionNumerator(position[0], denominator);
  if (numerator === undefined) {
    return undefined;
  }
  return [numerator, denominator];
}

function normalizePositionDenominator(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return normalizePositiveInt(value);
}

function normalizePositionNumerator(value: unknown, denominator: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return normalizeFractionNumerator(value, denominator);
}

function normalizeEventBmsonExtension(value: unknown): BeMusicEvent['bmson'] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const extension: NonNullable<BeMusicEvent['bmson']> = {};
  const length = normalizeBmsonNoteLength(raw.l);
  if (length !== undefined) {
    extension.l = length;
  }
  if (typeof raw.c === 'boolean') {
    extension.c = raw.c;
  }
  return Object.keys(extension).length > 0 ? extension : undefined;
}
