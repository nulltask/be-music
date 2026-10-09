import { createEmptyJson, type BeMusicJson } from '@be-music/json';

/**
 * Shares equal strings across every chart of one collection load. Event channels and values are a small vocabulary
 * (`"01"`, `"11"`, `"0A"`, …) repeated thousands of times per chart, so keeping one instance of each saves a few hundred
 * kilobytes per chart on a large drop.
 */
export function createStringInterner(): (value: string) => string {
  const table = new Map<string, string>();
  return (value) => {
    const shared = table.get(value);
    if (shared !== undefined) return shared;
    table.set(value, value);
    return value;
  };
}

/**
 * Trims a freshly parsed chart down to what the player keeps resident for every song in a collection. Mutates and
 * returns `chart`.
 *
 * - `preservation` (the source-line layers the stringifier uses for lossless round-trips) is reset to empty — the
 *   player never writes charts back, and that layer alone is about half of a parsed chart's heap.
 * - Event channel / value strings go through `intern`.
 * - `metadata`, `resources`, `bms` and `bmson` are deep-copied so their strings stop referencing the chart's decoded
 *   source text; otherwise a header such as `#TITLE` keeps the whole source text alive for as long as the song stays
 *   in the collection.
 */
export function compactCollectionChart(chart: BeMusicJson, intern: (value: string) => string): BeMusicJson {
  chart.preservation = createEmptyJson(chart.sourceFormat).preservation;
  for (const event of chart.events) {
    event.channel = intern(event.channel);
    event.value = intern(event.value);
  }
  chart.metadata = structuredClone(chart.metadata);
  chart.resources = structuredClone(chart.resources);
  chart.bms = structuredClone(chart.bms);
  chart.bmson = structuredClone(chart.bmson);
  return chart;
}
