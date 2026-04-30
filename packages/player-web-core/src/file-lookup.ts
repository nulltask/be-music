/**
 * Shared case-insensitive lookup helpers for `ReadonlyMap<string, Uint8Array>`
 * file maps used by the song collection (`BrowserSongAssetSource.files`)
 * and the LR2 skin asset map (`Lr2Skin.files`).
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

const indexCache: WeakMap<ReadonlyMap<string, Uint8Array>, ReadonlyMap<string, string>> = new WeakMap();

/**
 * Returns a `Map<lowerKey, originalKey>` for `files`, building it once
 * and caching afterwards. Multiple distinct keys that lowercase to the
 * same string are collapsed onto the **first** key encountered during
 * iteration — there's no good universal answer when a source legitimately
 * has both `parts.tga` and `PARTS.TGA` (filesystems that allow it are
 * rare), and picking the first means iteration order in the original
 * map is the tiebreaker, which matches what a single-pass loader sees.
 */
function getCaseInsensitiveIndex(files: ReadonlyMap<string, Uint8Array>): ReadonlyMap<string, string> {
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
export function findCaseInsensitivePath(files: ReadonlyMap<string, Uint8Array>, candidate: string): string | undefined {
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
  files: ReadonlyMap<string, Uint8Array>,
  candidate: string,
): Uint8Array | undefined {
  const key = findCaseInsensitivePath(files, candidate);
  return key === undefined ? undefined : files.get(key);
}
