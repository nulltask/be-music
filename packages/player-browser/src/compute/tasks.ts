import { unzipSync } from 'fflate';
import { countScoredNotes } from '@be-music/chart-model';
import { decodeUTF8Text, parseBMSBytes, parseBmson, parseLRXBytes, parseN2SBytes } from '@be-music/chart-parser/core';
import { type BeMusicJSON } from '@be-music/chart-source';
import { compactChartPreservation } from '../collection/chart-preservation.ts';
import { md5HexOfBytes } from '../collection/md5.ts';
import { deferChartFields, type DeferredChartFields } from '../collection/compact-chart.ts';
import { normalizePath } from '@be-music/shared-utils/core';
import { packEvents, PackedEventStrings, type PackedEvents } from '../collection/packed-events.ts';
import { timeStretchChannels } from '../runtime/time-stretch.ts';

export interface ParseChartTaskInput {
  path: string;
  bytes: Uint8Array;
  /** The files an LRX `.lrs` chart reads beside it: its `.lrh` header and its `.lrm` BGA file, when present. */
  siblings?: ChartSiblingBytes;
}
export interface ChartSiblingBytes {
  lrh?: Uint8Array;
  lrm?: Uint8Array;
}
export interface ParseChartTaskResult {
  chart: BeMusicJSON;
  scored: ReturnType<typeof countScoredNotes>;
  packed?: PackedEvents;
  strings: string[];
  /**
   * The chart's fields a listing does not read, taken out of `chart` as JSON text (`deferChartFields`); the collection
   * puts them back as it lists the chart (`restoreDeferredChartFields`).
   */
  deferred?: DeferredChartFields;
  /**
   * The MD5 (lowercase hex) of the chart file, worked out beside the parse while its bytes are in hand: with the
   * SHA-256 of its cache key it makes the chart's file hashes, so matching courses and records reads no file again.
   */
  md5?: string;
}
export function parseChartTask(input: ParseChartTaskInput): ParseChartTaskResult {
  const path = input.path.toLowerCase();
  const chart = path.endsWith('.bmson')
    ? parseBmson(decodeUTF8Text(input.bytes))
    : path.endsWith('.n2s')
      ? parseN2SBytes(input.bytes)
      : path.endsWith('.lrs')
        ? parseLRXBytes({ lrs: input.bytes, ...input.siblings })
        : parseBMSBytes(input.bytes);
  const scored = countScoredNotes(chart, { chartPath: input.path, inferBmsLNTypeWhenMissing: false });
  compactChartPreservation(chart);
  const strings = new PackedEventStrings();
  const packed = packEvents(chart.events, strings);
  if (packed) chart.events = [];
  const { chart: listing, deferred } = deferChartFields(chart);
  return {
    chart: listing,
    scored,
    packed,
    strings: packed ? strings.snapshot() : [],
    deferred,
    md5: md5HexOfBytes(input.bytes),
  };
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
