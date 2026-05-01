import type { BrowserSongAssetEntry } from './types.ts';

/**
 * Shared case-insensitive lookup helpers for the file maps used
 * by the song collection (`BrowserSongAssetSource.files`) and
 * the LR2 skin asset map (`Lr2Skin.files`).
 *
 * Map values can be either:
 *
 * - `Uint8Array` — bytes already in memory (small files / images
 *   / charts / skins); returned directly to the synchronous caller.
 * - `File` — a lazy `File` reference for large audio assets that
 *   shouldn't be slurped into memory up-front. Callers that
 *   need bytes await {@link loadAssetBytes}; callers that are
 *   fine with either branch take the union.
 *
 * Why this exists: BMS / bmson chart files reference WAV / BMP / image
 * assets by an arbitrary string (e.g. `#WAV01 kick.wav`). On case-
 * sensitive filesystems / the `webkitRelativePath` map produced by a
 * directory drop, the chart's casing has to match the file's casing
 * exactly — but real-world archives routinely mix `KICK.WAV` /
 * `kick.WAV` / `Kick.wav` etc. Same story for LR2 skins referencing
 * `LR2files\Theme\LR2\Result\parts.tga` while the actual filename on
 * disk is `Parts.TGA`.
 *
 * Strategy: a per-source lazy-built `Map<lowerKey, originalKey>` index
 * that lets the resolver fall back to a case-insensitive match after
 * the case-sensitive one misses. Keyed on the source map identity via
 * `WeakMap` so the cache vanishes the moment the source itself does
 * (and we never re-scan the same source twice).
 */

const indexCache: WeakMap<ReadonlyMap<string, BrowserSongAssetEntry>, ReadonlyMap<string, string>> = new WeakMap();

/**
 * Returns a `Map<lowerKey, originalKey>` for `files`, building it once
 * and caching afterwards. Multiple distinct keys that lowercase to the
 * same string are collapsed onto the **first** key encountered during
 * iteration — there's no good universal answer when a source legitimately
 * has both `parts.tga` and `PARTS.TGA` (filesystems that allow it are
 * rare), and picking the first means iteration order in the original
 * map is the tiebreaker, which matches what a single-pass loader sees.
 */
function getCaseInsensitiveIndex(files: ReadonlyMap<string, BrowserSongAssetEntry>): ReadonlyMap<string, string> {
  const cached = indexCache.get(files);
  if (cached) {
    return cached;
  }
  const index = new Map<string, string>();
  for (const key of files.keys()) {
    const lower = key.toLowerCase();
    if (!index.has(lower)) {
      index.set(lower, key);
    }
  }
  indexCache.set(files, index);
  return index;
}

/**
 * Returns the original key in `files` matching `candidate`, comparing
 * exact-match first and falling back to a case-insensitive match.
 * Returns `undefined` when no key matches under either comparison.
 *
 * The two-stage approach matters: callers that pass in a key they
 * know to be exact (e.g. iterating `files.keys()` themselves) get the
 * fast path with no Map allocation; only on a miss do we touch the
 * lazy index.
 */
export function findCaseInsensitivePath(files: ReadonlyMap<string, BrowserSongAssetEntry>, candidate: string): string | undefined {
  if (files.has(candidate)) {
    return candidate;
  }
  const index = getCaseInsensitiveIndex(files);
  return index.get(candidate.toLowerCase());
}

/**
 * Convenience wrapper that returns the bytes (or `undefined`) directly,
 * for call sites that don't need the original key.
 */
export function lookupBytesCaseInsensitive(
  files: ReadonlyMap<string, BrowserSongAssetEntry>,
  candidate: string,
): BrowserSongAssetEntry | undefined {
  const key = findCaseInsensitivePath(files, candidate);
  return key === undefined ? undefined : files.get(key);
}

/**
 * Forces a {@link BrowserSongAssetEntry} into a `Uint8Array`. If
 * the entry is a `File` (a lazy audio reference) this performs an
 * `arrayBuffer()` read on demand. The result is NOT cached on the
 * source map — callers that need to cache (e.g. the gameplay
 * sample decoder) should hold onto the returned buffer themselves.
 *
 * Returns `undefined` when the entry itself is undefined so the
 * common pattern `loadAssetBytes(lookupBytesCaseInsensitive(...))`
 * stays readable without an extra null-guard.
 */
export async function loadAssetBytes(
  entry: BrowserSongAssetEntry | undefined,
): Promise<Uint8Array | undefined> {
  if (entry === undefined) return undefined;
  if (entry instanceof Uint8Array) return entry;
  return new Uint8Array(await entry.arrayBuffer());
}

/**
 * Sync variant — returns the entry's bytes when they're already
 * resolved, `undefined` when it's a lazy `File` reference (the
 * caller has to use {@link loadAssetBytes} to read those). Used
 * by image / texture loaders that can't reasonably go async at
 * the call site.
 */
export function asLoadedBytes(entry: BrowserSongAssetEntry | undefined): Uint8Array | undefined {
  if (entry === undefined) return undefined;
  return entry instanceof Uint8Array ? entry : undefined;
}
