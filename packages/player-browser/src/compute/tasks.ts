import { unzipSync } from 'fflate';
import { countScoredNotes } from '@be-music/chart-model';
import { decodeBMSText, decodeUTF8Text, parseBMS, parseBmson } from '@be-music/chart-parser';
import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import { normalizePath } from '@be-music/shared-utils/core';
import { packEvents, PackedEventStrings, type PackedEvents } from '../collection/packed-events.ts';
import { timeStretchChannels } from '../runtime/time-stretch.ts';

export interface ParseChartTaskInput {
  path: string;
  bytes: Uint8Array;
}
export interface ParseChartTaskResult {
  chart: BeMusicJSON;
  scored: ReturnType<typeof countScoredNotes>;
  packed?: PackedEvents;
  strings: string[];
}
export function parseChartTask(input: ParseChartTaskInput): ParseChartTaskResult {
  const chart = input.path.toLowerCase().endsWith('.bmson')
    ? parseBmson(decodeUTF8Text(input.bytes))
    : parseBMS(decodeBMSText(input.bytes).text);
  const scored = countScoredNotes(chart, { chartPath: input.path, inferBmsLNTypeWhenMissing: true });
  chart.preservation = createEmptyJSON(chart.sourceFormat).preservation;
  const strings = new PackedEventStrings();
  const packed = packEvents(chart.events, strings);
  const values: string[] = [];
  if (packed) {
    let maximum = -1;
    for (const id of packed.channels) maximum = Math.max(maximum, id);
    for (const id of packed.values) maximum = Math.max(maximum, id);
    for (let index = 0; index <= maximum; index++) values.push(strings.valueOf(index));
    chart.events = [];
  }
  return { chart, scored, packed, strings: values };
}
export interface ZipTaskInput {
  bytes: Uint8Array;
  limit: number;
  limitMessage: string;
  skin?: boolean;
}
export function unzipTask(input: ZipTaskInput): Record<string, Uint8Array> {
  let total = 0;
  return unzipSync(input.bytes, {
    filter: (entry) => {
      const path = input.skin ? entry.name.replace(/\\/g, '/').replace(/^\.?\//, '') : normalizePath(entry.name);
      if (!path || entry.name.endsWith('/') || (input.skin && path.startsWith('__MACOSX/'))) return false;
      total += entry.originalSize;
      if (total > input.limit) throw new Error(input.limitMessage);
      return true;
    },
  });
}
export interface StretchTaskInput {
  channels: Float32Array[];
  sampleRate: number;
  rate: number;
}
export function stretchTask(input: StretchTaskInput): Float32Array[] {
  return timeStretchChannels(input.channels, input.sampleRate, input.rate);
}
/** Only explicit data-only operations can be requested by a host. */
export function executeBrowserTask(name: string, input: unknown): unknown {
  switch (name) {
    case 'parse-chart':
      return parseChartTask(input as ParseChartTaskInput);
    case 'unzip':
      return unzipTask(input as ZipTaskInput);
    case 'stretch':
      return stretchTask(input as StretchTaskInput);
    default:
      throw new Error(`Unknown browser task: ${name}`);
  }
}
