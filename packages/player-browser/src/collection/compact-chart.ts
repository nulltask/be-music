import { type BeMusicEvent, type BeMusicJSON } from '@be-music/chart-source';
import { compactChartPreservation } from './chart-preservation.ts';
import { PackedEventStrings, packEvents, unpackEvents, type PackedEvents } from './packed-events.ts';

export { PackedEventStrings } from './packed-events.ts';

/**
 * How many charts keep their unpacked `events` array alive at once. Select screens read `events` for the focused song
 * and the visible rows every frame, so this has to cover a screenful of rows with headroom; anything older is rebuilt
 * on its next read (about 0.1 ms for a typical chart).
 */
const UNPACKED_EVENTS_CACHE_SIZE = 64;

/** Least-recently-read charts first; re-reading a chart moves it to the end. */
const unpackedEvents = new Map<BeMusicJSON, BeMusicEvent[]>();

/**
 * Trims a freshly parsed chart down to what the player keeps resident for every song in a collection. Mutates and
 * returns `chart`.
 *
 * - `preservation` drops formatting and object lines. WAV headers and branch gates retain the source loader order
 *   LR2 EXTRA uses to group sounds; the player never writes charts back.
 * - `events` is packed into typed-array columns (see {@link packEvents}) and becomes an accessor that rebuilds the
 *   array on demand. The most recently read charts keep their rebuilt array (see {@link UNPACKED_EVENTS_CACHE_SIZE}),
 *   so repeated reads within a frame return the same array. Assigning `events` replaces the accessor with a plain
 *   value.
 * - `metadata`, `resources`, `bms`, `bmson` and `lrx` are deep-copied so their strings stop referencing the chart's decoded
 *   source text; otherwise a header such as `#TITLE` keeps the whole source text alive for as long as the song stays
 *   in the collection.
 *
 * The chart object itself keeps its identity, so caches keyed by the chart keep working.
 */
export function compactCollectionChart(chart: BeMusicJSON, strings: PackedEventStrings): BeMusicJSON {
  compactChartPreservation(chart);
  chart.metadata = structuredClone(chart.metadata);
  chart.resources = structuredClone(chart.resources);
  chart.bms = structuredClone(chart.bms);
  chart.bmson = structuredClone(chart.bmson);
  if (chart.lrx !== undefined) chart.lrx = structuredClone(chart.lrx);
  const packed = packEvents(chart.events, strings);
  if (packed !== undefined) {
    defineLazyEvents(chart, packed, strings);
  }
  return chart;
}

function defineLazyEvents(chart: BeMusicJSON, packed: PackedEvents, strings: PackedEventStrings): void {
  Object.defineProperty(chart, 'events', {
    configurable: true,
    enumerable: true,
    get(this: BeMusicJSON): BeMusicEvent[] {
      let events = unpackedEvents.get(this);
      if (events !== undefined) {
        unpackedEvents.delete(this);
      } else {
        events = unpackEvents(packed, strings);
        if (unpackedEvents.size >= UNPACKED_EVENTS_CACHE_SIZE) {
          unpackedEvents.delete(unpackedEvents.keys().next().value!);
        }
      }
      unpackedEvents.set(this, events);
      return events;
    },
    set(this: BeMusicJSON, events: BeMusicEvent[]) {
      unpackedEvents.delete(this);
      Object.defineProperty(this, 'events', { configurable: true, enumerable: true, writable: true, value: events });
    },
  });
}

/** Restore the lazy event accessor after a worker transfers packed columns. */
export function restorePackedCollectionChart(
  chart: BeMusicJSON,
  packed: PackedEvents | undefined,
  values: readonly string[],
): void {
  if (!packed) return;
  const strings = new PackedEventStrings();
  for (const value of values) strings.idOf(value);
  defineLazyEvents(chart, packed, strings);
}

/**
 * The fields of a chart a listing does not read, as JSON text: its resources, measures, format sections and
 * preservation. See {@link deferChartFields}.
 */
export interface DeferredChartFields {
  /** The fields' names, in the chart's own order. */
  readonly keys: readonly string[];
  /** The fields, as one JSON object. */
  readonly json: string;
}

/**
 * Splits a chart into its listing fields and the remaining fields as JSON text. Text crosses the worker and the
 * parsed-chart cache without copying a tree of objects. {@link restoreDeferredChartFields} restores the deferred
 * fields on first read.
 */
export function deferChartFields(chart: BeMusicJSON): { chart: BeMusicJSON; deferred: DeferredChartFields } {
  const { format, sourceFormat, metadata, events, ...fields } = chart;
  const record: Record<string, unknown> = fields;
  const keys = Object.keys(fields);
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    if (record[keys[index]!] === undefined) keys.splice(index, 1);
  }
  return {
    chart: { format, sourceFormat, metadata, events } as BeMusicJSON,
    deferred: { keys, json: JSON.stringify(fields) },
  };
}

/**
 * Puts the fields {@link deferChartFields} took out back on `chart`, as accessors that parse the text the first time
 * any of them is read; from then on they are plain values. Assigning one replaces it.
 */
export function restoreDeferredChartFields(chart: BeMusicJSON, deferred: DeferredChartFields | undefined): void {
  if (deferred === undefined) return;
  const record = chart as unknown as Record<string, unknown>;
  let json: string | undefined = deferred.json;
  const pending = new Set(deferred.keys);
  const settle = (): void => {
    if (json === undefined) return;
    const fields = JSON.parse(json) as Record<string, unknown>;
    json = undefined;
    for (const key of pending) {
      Object.defineProperty(record, key, { configurable: true, enumerable: true, writable: true, value: fields[key] });
    }
    pending.clear();
  };
  for (const key of deferred.keys) {
    Object.defineProperty(record, key, {
      configurable: true,
      enumerable: true,
      get(): unknown {
        settle();
        return record[key];
      },
      set(value: unknown) {
        pending.delete(key);
        Object.defineProperty(record, key, { configurable: true, enumerable: true, writable: true, value });
      },
    });
  }
}
