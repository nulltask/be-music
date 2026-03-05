import {
  compareEvents,
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
