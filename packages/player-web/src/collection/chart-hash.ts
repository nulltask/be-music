import { normalizePath } from '@be-music/utils/core';
import { loadAssetBytes, lookupBytesCaseInsensitive } from './file-lookup.ts';
import type { BrowserSongAssetSource } from './types.ts';

/**
 * SHA-256 (lowercase hex) of a byte buffer via Web Crypto. Shared by the play-log recorder plumbing (stamping
 * `chart.sha256` at record time) and the play-log drop matching (hashing loaded charts for comparison).
 */
export async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
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
export async function computeChartFileSha256(
  source: BrowserSongAssetSource | undefined,
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
    return await computeSha256Hex(bytes);
  } catch {
    return undefined;
  }
}
