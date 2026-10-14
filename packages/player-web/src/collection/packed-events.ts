import type { BeMusicEvent, BmsonEventExtensions } from '@be-music/json';

/** Lookups after which a load's string table also indexes two-character ids by their character codes. */
const PAIR_TABLE_AFTER = 2048;

/**
 * String table shared by every chart packed during one collection load. Event channels and values are a small
 * vocabulary (`"01"`, `"11"`, `"0A"`, …), so each packed event stores two small integers instead of two strings.
 */
export class PackedEventStrings {
  private readonly values: string[] = [];
  private readonly ids = new Map<string, number>();
  /**
   * Ids of two-character ASCII strings, nearly every channel and object id, by their two character codes: looked up per
   * event without hashing the string. Built only once a load has looked up {@link PAIR_TABLE_AFTER} values, so a small
   * load does not pay for the table; `-1` marks a pair not seen yet.
   */
  private asciiPairIds: Int32Array | undefined;
  private lookups = 0;

  idOf(value: string): number {
    const pairIds = this.asciiPairIds ?? this.buildPairTableWhenBusy();
    if (pairIds !== undefined && value.length === 2) {
      const high = value.charCodeAt(0);
      const low = value.charCodeAt(1);
      if (high < 128 && low < 128) {
        const slot = (high << 7) | low;
        let id = pairIds[slot]!;
        if (id < 0) {
          id = this.values.length;
          this.values.push(value);
          this.ids.set(value, id);
          pairIds[slot] = id;
        }
        return id;
      }
    }
    let id = this.ids.get(value);
    if (id === undefined) {
      id = this.values.length;
      this.values.push(value);
      this.ids.set(value, id);
    }
    return id;
  }

  private buildPairTableWhenBusy(): Int32Array | undefined {
    this.lookups += 1;
    if (this.lookups < PAIR_TABLE_AFTER) return undefined;
    const pairIds = new Int32Array(128 * 128).fill(-1);
    for (const [value, id] of this.ids) {
      if (value.length === 2 && value.charCodeAt(0) < 128 && value.charCodeAt(1) < 128) {
        pairIds[(value.charCodeAt(0) << 7) | value.charCodeAt(1)] = id;
      }
    }
    this.asciiPairIds = pairIds;
    return pairIds;
  }

  valueOf(id: number): string {
    return this.values[id]!;
  }
}

/**
 * Column-oriented copy of a chart's `events`: about 20 bytes per event instead of the ~130 bytes an event object, its
 * `position` tuple and their headers take on the heap.
 */
export interface PackedEvents {
  readonly length: number;
  readonly measures: Int32Array;
  readonly channels: Uint32Array;
  readonly values: Uint32Array;
  readonly numerators: Int32Array | Float64Array;
  readonly denominators: Int32Array | Float64Array;
  /** bmson per-note extensions, by event index. Only bmson charts carry them. */
  readonly bmson: ReadonlyMap<number, BmsonEventExtensions> | undefined;
}

const EVENT_KEYS = new Set(['measure', 'channel', 'position', 'value', 'bmson']);

/**
 * Packs `events` into columns. Returns `undefined` when an event carries a field this format doesn't model, in which
 * case the caller keeps the original array so nothing is lost.
 */
export function packEvents(events: readonly BeMusicEvent[], strings: PackedEventStrings): PackedEvents | undefined {
  const length = events.length;
  let integral = true;
  for (const event of events) {
    for (const key in event) {
      if (!EVENT_KEYS.has(key)) return undefined;
    }
    if (!Number.isInteger(event.measure) || event.measure < -0x80000000 || event.measure > 0x7fffffff) return undefined;
    const [numerator, denominator] = event.position;
    if (!isInt32(numerator) || !isInt32(denominator)) integral = false;
  }
  const measures = new Int32Array(length);
  const channels = new Uint32Array(length);
  const values = new Uint32Array(length);
  const numerators = integral ? new Int32Array(length) : new Float64Array(length);
  const denominators = integral ? new Int32Array(length) : new Float64Array(length);
  let bmson: Map<number, BmsonEventExtensions> | undefined;
  for (let index = 0; index < length; index += 1) {
    const event = events[index]!;
    measures[index] = event.measure;
    channels[index] = strings.idOf(event.channel);
    values[index] = strings.idOf(event.value);
    numerators[index] = event.position[0];
    denominators[index] = event.position[1];
    if ('bmson' in event) {
      bmson ??= new Map();
      bmson.set(index, event.bmson!);
    }
  }
  return { length, measures, channels, values, numerators, denominators, bmson };
}

/** Rebuilds the event objects {@link packEvents} packed, with the same fields in the same order. */
export function unpackEvents(packed: PackedEvents, strings: PackedEventStrings): BeMusicEvent[] {
  const events: BeMusicEvent[] = Array.from({ length: packed.length });
  const { measures, channels, values, numerators, denominators, bmson } = packed;
  for (let index = 0; index < packed.length; index += 1) {
    const event: BeMusicEvent = {
      measure: measures[index]!,
      channel: strings.valueOf(channels[index]!),
      position: [numerators[index]!, denominators[index]!],
      value: strings.valueOf(values[index]!),
    };
    const extensions = bmson?.get(index);
    if (extensions !== undefined) {
      event.bmson = extensions;
    }
    events[index] = event;
  }
  return events;
}

function isInt32(value: number): boolean {
  return Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
}
