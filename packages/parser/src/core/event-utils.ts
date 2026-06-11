import { compareEvents } from '@be-music/chart';
import {
  normalizeChannel,
  normalizeObjectKey,
  type BeMusicEvent,
  type BeMusicJson,
  type BeMusicPosition,
  type BmsObjectLineEntry,
} from '@be-music/json';
import {
  normalizeAsciiBase36Code,
  normalizeAsciiBase62Code,
  normalizeFractionNumerator,
  normalizeNonNegativeInt,
  normalizePositiveInt,
} from '@be-music/utils/core';

type MeasureLengthEntry = BeMusicJson['measures'][number];

export function normalizeBmsonNoteLength(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

/**
 * Tokenizes a BMS channel-object stream (the body of e.g. `#xxxYY:ZZ...`) into 2-character object IDs.
 *
 * - The total `tokenCount` (= denominator) counts EVERY 2-char slot including `00` placeholders — needed to compute
 *   fractional beat positions.
 * - The returned `tokens` array only includes NON-ZERO entries (zeros are silent placeholders, not events).
 *
 * `base` controls the per-character validator: - `36` (default): ASCII `[0-9A-Za-z]` is accepted and lowercase is
 * FOLDED to uppercase, so `0a` and `0A` collapse to the same ID. - `62`: lowercase is preserved, so `0a` and `0A` are
 * distinct. Used when the chart declared `#BASE 62`.
 */
export function collectNonZeroObjectTokens(
  input: string,
  base: 36 | 62 = 36,
): {
  tokenCount: number;
  tokens: Array<{ index: number; value: string }>;
} {
  const normalize = base === 62 ? normalizeAsciiBase62Code : normalizeAsciiBase36Code;
  const tokens: Array<{ index: number; value: string }> = [];
  let tokenCount = 0;
  let highCode = -1;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    const normalizedCode = normalize(code);
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

/**
 * Builds the canonical entry for one BMS object data line (`#mmmcc:data`).
 *
 * Single implementation of the line → entry rule shared by the strict parse path and the control-flow capture path
 * (`#RANDOM` / `#IF` / `#SWITCH` bodies), so both interpret a line identically:
 *
 * - Channel `02` carries a measure-length factor — parsed as float, non-positive / non-finite values are dropped.
 * - Every other channel is a token stream — `00` is a rest, non-zero 2-char tokens become events positioned as
 *   `[tokenIndex, tokenCount]`.
 *
 * Returns `undefined` when the line contributes nothing (invalid measure length / only rests).
 */
export function buildBmsObjectLineEntry(
  measure: number,
  channel: string,
  data: string,
  base: 36 | 62 = 36,
): BmsObjectLineEntry | undefined {
  if (channel === '02') {
    const measureLength = Number.parseFloat(data);
    if (!Number.isFinite(measureLength) || measureLength <= 0) {
      return undefined;
    }
    return {
      measure,
      channel,
      events: [],
      measureLength,
    };
  }

  const parsed = collectNonZeroObjectTokens(data, base);
  const events: BeMusicEvent[] = [];
  for (const token of parsed.tokens) {
    events.push({
      measure,
      channel,
      position: [token.index, parsed.tokenCount],
      value: token.value,
    });
  }
  if (events.length === 0) {
    return undefined;
  }
  return {
    measure,
    channel,
    events,
  };
}

export function sortAndNormalizeEvents(
  events: Array<BeMusicEvent | Record<string, unknown>>,
  base: 36 | 62 = 36,
): BeMusicEvent[] {
  const normalized: BeMusicEvent[] = [];
  for (const event of events) {
    const parsed = normalizeRawEvent(event, base);
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

function normalizeRawEvent(
  event: BeMusicEvent | Record<string, unknown>,
  base: 36 | 62 = 36,
): BeMusicEvent | undefined {
  const raw = event as Record<string, unknown>;
  const measure = normalizeMeasure(raw.measure);
  const channel = normalizeEventChannel(raw.channel);
  const value = normalizeEventValue(raw.value, base);
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

function normalizeEventValue(value: unknown, base: 36 | 62 = 36): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return normalizeObjectKey(value, base);
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
  // Per-mine gauge damage — sourced from bmson `key_channels[].notes[].damage`. 0 is a valid value (the chart authored
  // a no-damage decoration mine), so the guard checks `Number.isFinite` rather than truthiness.
  if (typeof raw.damage === 'number' && Number.isFinite(raw.damage) && raw.damage >= 0) {
    extension.damage = raw.damage;
  }
  return Object.keys(extension).length > 0 ? extension : undefined;
}
