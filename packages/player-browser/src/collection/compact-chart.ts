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
 * - `metadata`, `resources`, `bms` and `bmson` are deep-copied so their strings stop referencing the chart's decoded
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
