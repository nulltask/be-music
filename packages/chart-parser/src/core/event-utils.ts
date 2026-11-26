import { cloneJSONFields } from '@be-music/chart-source';
import { sortEventsInPlace } from '@be-music/chart-model';
import {
  normalizeChannel,
  normalizeObjectKey,
  type BeMusicEvent,
  type BeMusicJSON,
  type BeMusicPosition,
  type BMSObjectLineEntry,
} from '@be-music/chart-source';
import {
  normalizeASCIIBase36Code,
  normalizeASCIIBase62Code,
  normalizeFractionNumerator,
  normalizeNonNegativeInt,
  normalizePositiveInt,
} from '@be-music/shared-utils/core';

import { normalizeLRXEventExtensions } from './lrx-extensions.ts';

type MeasureLengthEntry = BeMusicJSON['measures'][number];

export function normalizeBmsonNoteLength(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
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
export function buildBMSObjectLineEntry(
  measure: number,
  channel: string,
  data: string,
  base: 36 | 62 = 36,
): BMSObjectLineEntry | undefined {
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

  const normalize = base === 62 ? normalizeASCIIBase62Code : normalizeASCIIBase36Code;
  const events: Array<Omit<BeMusicEvent, 'position'> & { position: [number, number] }> = [];
  let tokenCount = 0;
  let highCode = -1;
  for (let index = 0; index < data.length; index += 1) {
    const code = data.charCodeAt(index);
    // BMS reads one contiguous run of slots. Text after whitespace takes no space in the measure.
    if (code === 0x20 || code === 0x09 || code === 0x0b || code === 0x0c) break;
    const normalizedCode = normalize(code);
    if (normalizedCode < 0) continue;
    if (highCode < 0) {
      highCode = normalizedCode;
      continue;
    }
    if (highCode !== 0x30 || normalizedCode !== 0x30) {
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
  // The denominator counts every complete slot, including rests.
  for (const event of events) event.position[1] = tokenCount;
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
  allowLongKeys = false,
): BeMusicEvent[] {
  const normalized: BeMusicEvent[] = [];
  for (const event of events) {
    const parsed = normalizeRawEvent(event, base, allowLongKeys);
    if (parsed) {
      normalized.push(parsed);
    }
  }

  sortEventsInPlace(normalized);
  return normalized;
}

export function upsertMeasureLength(
  json: BeMusicJSON,
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
  allowLongKeys = false,
): BeMusicEvent | undefined {
  const raw = event as Record<string, unknown>;
  const measure = normalizeMeasure(raw.measure);
  const channel = normalizeEventChannel(raw.channel);
  const value = normalizeEventValue(raw.value, base, allowLongKeys);
  const position = normalizePosition(raw.position);
  if (measure === undefined || channel === undefined || value === undefined || position === undefined) {
    return undefined;
  }
  const bmson = normalizeEventBmsonExtension(raw.bmson);
  const lrx = normalizeLRXEventExtensions(raw.lrx);
  // Optional fields are assigned rather than spread, so every event shares the hidden classes the parsers' plain event
  // literals start from; spreads give each call site its own, and the extra shapes slow every event comparison.
  const normalized: BeMusicEvent = { measure, channel, position, value };
  if (typeof raw.bmsLineOrder === 'number' && Number.isSafeInteger(raw.bmsLineOrder) && raw.bmsLineOrder >= 0) {
    normalized.bmsLineOrder = raw.bmsLineOrder;
  }
  if (bmson) normalized.bmson = bmson;
  if (lrx) normalized.lrx = lrx;
  return normalized;
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

function normalizeEventValue(value: unknown, base: 36 | 62 = 36, allowLongKeys = false): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return normalizeObjectKey(value, base, allowLongKeys);
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
  const extraFields = cloneJSONFields(raw.extraFields);
  if (extraFields) extension.extraFields = extraFields;
  for (const key of ['sampleOffsetSeconds', 'sampleDurationSeconds'] as const) {
    const seconds = raw[key];
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) extension[key] = seconds;
  }
  const length = normalizeBmsonNoteLength(raw.l);
  if (length !== undefined) {
    extension.l = length;
  }
  if (typeof raw.up === 'boolean') extension.up = raw.up;
  if (typeof raw.c === 'boolean') {
    extension.c = raw.c;
  }
  // beatoraja bmson extension — per-note long-note type (1: LN, 2: CN, 3: HCN).
  if (raw.t === 1 || raw.t === 2 || raw.t === 3) {
    extension.t = raw.t;
  }
  // Per-mine gauge damage — sourced from bmson `mine_channels[].notes[].damage`. 0 is a valid value (the chart authored
  // a no-damage decoration mine), so the guard checks `Number.isFinite` rather than truthiness.
  if (typeof raw.damage === 'number' && Number.isFinite(raw.damage) && raw.damage >= 0) {
    extension.damage = raw.damage;
  }
  return Object.keys(extension).length > 0 ? extension : undefined;
}
