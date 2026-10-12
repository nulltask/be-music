import type { BeMusicEvent, BmsonEventExtensions } from '@be-music/json';

/**
 * String table shared by every chart packed during one collection load. Event channels and values are a small
 * vocabulary (`"01"`, `"11"`, `"0A"`, …), so each packed event stores two small integers instead of two strings.
 */
export class PackedEventStrings {
  private readonly values: string[] = [];
  private readonly ids = new Map<string, number>();

  idOf(value: string): number {
    let id = this.ids.get(value);
    if (id === undefined) {
      id = this.values.length;
      this.values.push(value);
      this.ids.set(value, id);
    }
    return id;
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
