import { sha256HexAsync } from '@be-music/shared-utils/hash';
import { normalizePath } from '@be-music/shared-utils/core';
import { loadAssetBytes, lookupBytesCaseInsensitive } from './file-lookup.ts';
import { md5HexOfBytes } from './md5.ts';
import type { BeMusicJSON } from '@be-music/chart-source';
import type { BrowserAssetSource } from './types.ts';

/**
 * SHA-256 (lowercase hex) of a byte buffer via Web Crypto. Shared by the replay recorder plumbing (stamping
 * `chart.sha256` at record time) and the replay drop matching (hashing loaded charts for comparison).
 */
export async function computeSHA256Hex(bytes: Uint8Array): Promise<string> {
  return sha256HexAsync(bytes);
}

/**
 * SHA-256 (lowercase hex) of a song entry's source chart FILE bytes, or `undefined` when the chart file cannot be
 * located in the asset source (or the runtime lacks Web Crypto). The hash is over the file exactly as dropped —
 * the same bytes any other tool would hash — so it is stable across sessions, machines, and `#RANDOM` rolls.
 */
export async function computeChartFileSHA256(
  source: BrowserAssetSource | undefined,
  chartPath: string,
): Promise<string | undefined> {
  if (!source || typeof crypto === 'undefined' || !crypto.subtle) {
    return undefined;
  }
  const entry = lookupBytesCaseInsensitive(source.files, normalizePath(chartPath));
  const bytes = await loadAssetBytes(entry);
  if (!bytes) {
    return undefined;
  }
  try {
    return await computeSHA256Hex(bytes);
  } catch {
    return undefined;
  }
}

/** The file hashes of a chart: SHA-256 (the replay's primary key) and MD5 (how LR2 and LR2IR name a chart). */
export interface ChartFileHashes {
  sha256: string;
  md5: string;
}

/**
 * SHA-256 and MD5 (lowercase hex) of a song entry's source chart FILE bytes, read once. `undefined` when the chart file
 * cannot be located in the asset source or the runtime lacks Web Crypto, as with {@link computeChartFileSHA256}.
 */
export async function computeChartFileHashes(
  source: BrowserAssetSource | undefined,
  chartPath: string,
): Promise<ChartFileHashes | undefined> {
  if (!source || typeof crypto === 'undefined' || !crypto.subtle) {
    return undefined;
  }
  const entry = lookupBytesCaseInsensitive(source.files, normalizePath(chartPath));
  const bytes = await loadAssetBytes(entry);
  if (!bytes) {
    return undefined;
  }
  try {
    return { sha256: await computeSHA256Hex(bytes), md5: md5HexOfBytes(bytes) };
  } catch {
    return undefined;
  }
}

/** The file hashes the collection loader kept for a chart, by the chart it listed. */
const FILE_HASHES_BY_CHART = new WeakMap<BeMusicJSON, ChartFileHashes>();

/**
 * Keeps a chart's file hashes with the chart, as the collection loader does for a chart whose file it hashed (or whose
 * hashes came back with its parse from the parsed-chart cache): whoever needs them later reads no file.
 */
export function seedChartFileHashes(chart: BeMusicJSON, hashes: ChartFileHashes): void {
  FILE_HASHES_BY_CHART.set(chart, hashes);
}

/** The file hashes kept with a chart ({@link seedChartFileHashes}), or `undefined` for a chart that has none. */
export function seededChartFileHashes(chart: BeMusicJSON): ChartFileHashes | undefined {
  return FILE_HASHES_BY_CHART.get(chart);
}

/**
 * The file hashes a parsed-chart cache key and the MD5 kept beside the parse stand for: the key starts with the
 * SHA-256 of the chart file. `undefined` without both.
 */
export function chartFileHashesOfCacheKey(
  key: string | undefined,
  md5: string | undefined,
): ChartFileHashes | undefined {
  if (key === undefined || md5 === undefined) return undefined;
  const sha256 = key.slice(0, 64);
  return /^[0-9a-f]{64}$/u.test(sha256) && /^[0-9a-f]{32}$/u.test(md5) ? { sha256, md5 } : undefined;
}
