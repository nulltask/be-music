import { basename, dirname, normalizePath } from '@be-music/utils/core';
import { asLoadedBytes, findCaseInsensitivePath, lookupBytesCaseInsensitive } from './file-lookup.ts';
import type { Lr2SkinFileEntry } from './file-lookup.ts';
import type { Lr2Skin } from './skin.ts';

/**
 * One pre-decomposed entry in a basename-keyed file index. Building these once per source map removes the per-call
 * `path.toLowerCase()` / `.split('/')` work that the previous `[...keys()].find(...)` walks repeated for every asset
 * lookup. The fields are lowercased on construction so suffix-match comparisons can run directly without re-lowering.
 */
interface BasenameIndexEntry {
  /** The original (case-preserved) key from the source map — what callers return to look the file up. */
  readonly originalKey: string;
  /** Lowercased full key for full-path comparisons. */
  readonly lowerKey: string;
  /** Lowercased final path segment (`foo/bar/baz.png` → `baz.png`). */
  readonly basenameLower: string;
  /** Lowercased parent directory name (`foo/bar/baz.png` → `bar`); `''` when the file has no parent dir. */
  readonly parentLower: string;
  /** Lowercased grandparent directory name (`foo/bar/baz.png` → `foo`); `''` when missing. */
  readonly grandParentLower: string;
}

interface BasenameIndex {
  /** Bucketed by lowercase basename so a known filename lookup is O(1) on the bucket. */
  readonly byBasename: ReadonlyMap<string, readonly BasenameIndexEntry[]>;
}

/**
 * WeakMap-backed cache so we build each source map's basename index exactly once. Keyed by the map reference itself —
 * the LR2 skin's `files` map is built fresh per drop / per `readFilesIntoBytesMap` call, so cache invalidation falls
 * out naturally when the user re-imports a different theme.
 *
 * The previous resolver paths in `resolveLr2IncludePath` / `resolveLr2AssetBytes` did `[...sourceFiles.keys()]` 1–3
 * times per call, spreading the entire keys iterator into a fresh array and then re-running `path.toLowerCase()` on
 * every entry inside the `.find()` predicate. The LR2 default theme ships hundreds of files; that scan dominated theme
 * load + every per-frame `#CUSTOMFILE` wildcard resolution.
 */
const basenameIndexCache: WeakMap<ReadonlyMap<string, unknown>, BasenameIndex> = new WeakMap();

function getBasenameIndex<T>(files: ReadonlyMap<string, T>): BasenameIndex {
  const cacheKey = files as ReadonlyMap<string, unknown>;
  const cached = basenameIndexCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const byBasename = new Map<string, BasenameIndexEntry[]>();
  for (const originalKey of files.keys()) {
    const lowerKey = originalKey.toLowerCase();
    // Walk from the end to find the basename / parent / grandparent without materialising the full split array. Same
    // result as `split('/').slice(-3)` for typical paths but allocation-free.
    const lastSlash = lowerKey.lastIndexOf('/');
    const basenameLower = lastSlash === -1 ? lowerKey : lowerKey.slice(lastSlash + 1);
    let parentLower = '';
    let grandParentLower = '';
    if (lastSlash !== -1) {
      const secondSlash = lowerKey.lastIndexOf('/', lastSlash - 1);
      parentLower = secondSlash === -1 ? lowerKey.slice(0, lastSlash) : lowerKey.slice(secondSlash + 1, lastSlash);
      if (secondSlash !== -1) {
        const thirdSlash = lowerKey.lastIndexOf('/', secondSlash - 1);
        grandParentLower =
          thirdSlash === -1 ? lowerKey.slice(0, secondSlash) : lowerKey.slice(thirdSlash + 1, secondSlash);
      }
    }
    const entry: BasenameIndexEntry = { originalKey, lowerKey, basenameLower, parentLower, grandParentLower };
    const bucket = byBasename.get(basenameLower);
    if (bucket) {
      bucket.push(entry);
    } else {
      byBasename.set(basenameLower, [entry]);
    }
  }
  const index: BasenameIndex = { byBasename };
  basenameIndexCache.set(cacheKey, index);
  return index;
}

/**
 * Returns the bucket for an exact-basename lookup, or `undefined` if no file in the source map shares this basename.
 * Centralised so the call sites don't have to reach into the index's internals.
 */
function getBasenameBucket<T>(
  files: ReadonlyMap<string, T>,
  basenameLower: string,
): readonly BasenameIndexEntry[] | undefined {
  const index = getBasenameIndex(files);
  return index.byBasename.get(basenameLower);
}

/**
 * Iterates every basename bucket whose key matches `pattern`. Used for `#CUSTOMFILE` wildcard paths like `*.bmp` — only
 * the basename can carry a wildcard in LR2's path grammar, so the regex never needs to be tested against entire keys.
 * For non-wildcard inputs the caller should prefer {@link getBasenameBucket}.
 */
function findMatchingBasenameBuckets<T>(
  files: ReadonlyMap<string, T>,
  pattern: RegExp,
): readonly (readonly BasenameIndexEntry[])[] {
  const index = getBasenameIndex(files);
  const matches: (readonly BasenameIndexEntry[])[] = [];
  for (const [key, bucket] of index.byBasename) {
    if (pattern.test(key)) {
      matches.push(bucket);
    }
  }
  return matches;
}

export function resolveLr2IncludePath(
  sourceFiles: ReadonlyMap<string, Lr2SkinFileEntry>,
  baseDirectory: string,
  rawPath: string,
): string | undefined {
  const normalized = normalizeLr2Path(rawPath);
  const fileName = basename(normalized).toLowerCase();
  const parentDir = dirname(normalized);
  const parentName = basename(parentDir).toLowerCase();
  const grandParent = basename(dirname(parentDir)).toLowerCase();
  const candidates = [
    normalizePath(`${baseDirectory}/${normalized}`),
    normalized,
    normalizePath(`${baseDirectory}/${basename(normalized)}`),
  ];
  // Case-insensitive exact-match: real LR2 themes reference paths like `LR2files\Theme\LR2\Result\result_normal.csv`
  // while the dropped directory layout might be `LR2files/theme/lr2/Result/...`. `findCaseInsensitivePath` returns the
  // original key (so the recursive `readLr2Path(sourceFiles.get(returnedKey))` lookup hits a real entry), or undefined
  // to fall through to the partial-path walks below.
  for (const candidate of candidates) {
    const matched = findCaseInsensitivePath(sourceFiles, candidate);
    if (matched) {
      return matched;
    }
  }
  // Suffix-match walks: previously did `[...sourceFiles.keys()].find(path => path.toLowerCase().endsWith(...))` for
  // every fallback level, spreading the whole key set into a fresh array each time. The basename index lets us bucket
  // candidates by basename up front and then check just the parent / grandparent segments.
  const bucket = getBasenameBucket(sourceFiles, fileName);
  if (!bucket) {
    return undefined;
  }
  if (grandParent && parentName) {
    for (const entry of bucket) {
      if (entry.parentLower === parentName && entry.grandParentLower === grandParent) {
        return entry.originalKey;
      }
    }
  }
  if (parentName) {
    for (const entry of bucket) {
      if (entry.parentLower === parentName) {
        return entry.originalKey;
      }
    }
  }
  // The original code accepted both `…/fileName` and bare `fileName` (no slash) — both forms now land in the same
  // basename bucket since basenames don't include the leading slash.
  return bucket[0]?.originalKey;
}

export function resolveLr2AssetBytes(skin: Lr2Skin, rawPath: string): Uint8Array | undefined {
  const normalized = normalizeLr2Path(rawPath);
  const candidates = [normalized, basename(normalized)];
  // Skin assets (TGA / PNG / BMP / DXA / .lr2font) are non-audio and stored eagerly in the skin's files map, so the
  // `asLoadedBytes` narrowing here is just a type guard. Case-insensitive exact-match: skin elements that reference
  // `LR2files\Theme\LR2\Result\parts.tga` should resolve when the dropped tree spells the file `Parts.TGA`. Falls
  // through to the wildcard / parent-suffix walks below for genuinely partial-path references (e.g. `*.bmp`
  // `#CUSTOMFILE` patterns).
  for (const candidate of candidates) {
    const bytes = asLoadedBytes(lookupBytesCaseInsensitive(skin.files, candidate));
    if (bytes) {
      return bytes;
    }
  }
  const fileNameRaw = basename(normalized);
  const fileNamePattern = wildcardToRegExp(fileNameRaw);
  const parentDir = dirname(normalized);
  const parentName = basename(parentDir).toLowerCase();
  const grandParent = basename(dirname(parentDir)).toLowerCase();

  // Fast path: pattern has no wildcard ⇒ basename match is a direct bucket lookup. The wildcard regex is built either
  // way but the bucket walk avoids scanning the entire file map.
  const hasWildcard = fileNameRaw.includes('*');
  const buckets = hasWildcard
    ? findMatchingBasenameBuckets(skin.files, fileNamePattern)
    : ((): (readonly BasenameIndexEntry[])[] => {
        const bucket = getBasenameBucket(skin.files, fileNameRaw.toLowerCase());
        return bucket ? [bucket] : [];
      })();

  if (buckets.length === 0) {
    return undefined;
  }
  if (grandParent && parentName) {
    for (const bucket of buckets) {
      for (const entry of bucket) {
        if (entry.parentLower === parentName && entry.grandParentLower === grandParent) {
          return asLoadedBytes(skin.files.get(entry.originalKey));
        }
      }
    }
  }
  if (parentName) {
    for (const bucket of buckets) {
      for (const entry of bucket) {
        if (entry.parentLower === parentName) {
          return asLoadedBytes(skin.files.get(entry.originalKey));
        }
      }
    }
  }
  for (const bucket of buckets) {
    for (const entry of bucket) {
      return asLoadedBytes(skin.files.get(entry.originalKey));
    }
  }
  return undefined;
}

export function normalizeLr2Path(path: string): string {
  return normalizePath(path.replace(/^\.\\?/u, ''));
}

export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'iu');
}
