/**
 * The text file shipped next to a chart (an LR2 skin's READ TEXT button, a be-music skin's readme toggle): finding it
 * among the chart's files and decoding it. BMS authors traditionally ship notes and changelogs this way.
 */

import { dirname } from '@be-music/utils/core';
import { loadAssetBytes, resolveSongSource } from '../../collection/collection.ts';
import type { BrowserSongCollection, BrowserSongEntry } from '../../collection/types.ts';

/** The `.txt` files directly inside the folder of `song`'s chart, in the source's order. */
function readtextPaths(collection: BrowserSongCollection, song: BrowserSongEntry): string[] {
  const source = resolveSongSource(collection, song);
  if (!source) return [];
  const dir = dirname(song.chartPath).toLowerCase();
  const paths: string[] = [];
  for (const path of source.files.keys()) {
    if (!path.toLowerCase().endsWith('.txt')) continue;
    if (dirname(path).toLowerCase() === dir) paths.push(path);
  }
  return paths;
}

/** Whether the folder of `song`'s chart holds a text (`.txt`) file: LR2's readme (ops 174 / 175). */
export function hasReadtextForSong(collection: BrowserSongCollection, song: BrowserSongEntry): boolean {
  return readtextPaths(collection, song).length > 0;
}

/**
 * The decoded contents of the first `.txt` file directly inside the folder of `song`'s chart (no sub-folder, no folder
 * above), in the source's order (the directory listing, or a ZIP's central directory), or `undefined` when there is
 * none. The files of a dropped folder are read on demand.
 */
export async function findReadtextForSong(
  collection: BrowserSongCollection,
  song: BrowserSongEntry,
): Promise<string | undefined> {
  const source = resolveSongSource(collection, song);
  if (!source) return undefined;
  for (const path of readtextPaths(collection, song)) {
    const entry = source.files.get(path);
    if (entry === undefined) continue;
    const bytes = await loadAssetBytes(entry);
    if (!bytes) continue;
    return decodeReadtextBytes(bytes);
  }
  return undefined;
}

/**
 * Decodes raw `.txt` bytes to a string. BMS author notes are historically Shift-JIS (the LR2 era's default codepage on
 * Japanese Windows installs), but modern releases sometimes ship as UTF-8 with or without a BOM. UTF-8 first when a BOM
 * is present (unambiguous), then Shift-JIS, and finally lossy UTF-8, so there is always *some* string.
 */
export function decodeReadtextBytes(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(3));
  }
  try {
    const sjis = new TextDecoder('shift-jis', { fatal: false }).decode(bytes);
    if (sjis.length > 0 && !sjis.includes('�')) return sjis;
  } catch {
    // `shift-jis` not available in this runtime — fall through.
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
