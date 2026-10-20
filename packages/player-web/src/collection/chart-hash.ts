import { normalizePath } from '@be-music/utils/core';
import { loadAssetBytes, lookupBytesCaseInsensitive } from './file-lookup.ts';
import { md5HexOfBytes } from './md5.ts';
import type { BrowserAssetSource } from './types.ts';

/**
 * SHA-256 (lowercase hex) of a byte buffer via Web Crypto. Shared by the replay recorder plumbing (stamping
 * `chart.sha256` at record time) and the replay drop matching (hashing loaded charts for comparison).
 */
export async function computeSHA256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  let hex = '';
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
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
