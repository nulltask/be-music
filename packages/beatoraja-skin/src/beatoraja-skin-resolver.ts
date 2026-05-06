// Path resolution for beatoraja skins.
//
// Inside a `.json` or `.luaskin` file every `path` field is relative to that skin file's directory. The path may
// also contain `*` wildcards (e.g. `play/background/*.png`) — beatoraja picks one matching file at random when the
// player hasn't chosen one explicitly via `filepath[]`. We resolve all of those here so consumers never need to know
// about the original path syntax.

import { dirname, normalizePath } from '@be-music/utils/core';
import { findCaseInsensitivePath } from './file-lookup.ts';
import type { BeatorajaSkinFileEntry } from './file-lookup.ts';

/**
 * Resolve a `path` field relative to an entry skin file. Handles `..` and `./` segments and lower-cases the lookup
 * to survive cross-platform casing drift in user-shipped themes.
 *
 * Returns the canonical path actually present in `files` (so downstream code can index into it without recomputing
 * the case-insensitive lookup), or `undefined` when nothing matches.
 */
export function resolveBeatorajaPath(
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
  entryPath: string,
  relative: string,
): string | undefined {
  const baseDir = dirname(normalizePath(entryPath));
  const candidate = baseDir.length > 0 ? `${baseDir}/${relative}` : relative;
  const normalized = normalizePath(candidate);
  return findCaseInsensitivePath(files, normalized);
}

/**
 * Expand a possibly-wildcarded `path` into the set of files that match. Beatoraja only supports a single `*` wildcard
 * in the basename ("play/background/*.png"); we honor that contract and also tolerate `*` mid-segment because some
 * community themes use it as a basename prefix glob.
 *
 * The returned paths are the canonical keys found in `files` (matching {@link resolveBeatorajaPath}'s return value),
 * sorted lexicographically so callers that pick the first match are deterministic across reloads.
 */
export function expandBeatorajaWildcard(
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
  entryPath: string,
  relative: string,
): string[] {
  if (!relative.includes('*')) {
    const single = resolveBeatorajaPath(files, entryPath, relative);
    return single === undefined ? [] : [single];
  }

  const baseDir = dirname(normalizePath(entryPath));
  const fullGlob = baseDir.length > 0 ? `${baseDir}/${relative}` : relative;
  const normalizedGlob = normalizePath(fullGlob);

  const slashIdx = normalizedGlob.lastIndexOf('/');
  const dirPart = slashIdx >= 0 ? normalizedGlob.slice(0, slashIdx) : '';
  const filePattern = slashIdx >= 0 ? normalizedGlob.slice(slashIdx + 1) : normalizedGlob;
  const dirPartLower = dirPart.toLowerCase();
  const matcher = compileWildcard(filePattern);

  const matches: string[] = [];
  for (const key of files.keys()) {
    const lowerKey = key.toLowerCase();
    const lastSlash = lowerKey.lastIndexOf('/');
    const keyDir = lastSlash >= 0 ? lowerKey.slice(0, lastSlash) : '';
    const keyName = lastSlash >= 0 ? lowerKey.slice(lastSlash + 1) : lowerKey;
    if (keyDir !== dirPartLower) continue;
    if (matcher(keyName)) {
      matches.push(key);
    }
  }
  matches.sort();
  return matches;
}

function compileWildcard(pattern: string): (candidate: string) => boolean {
  const lower = pattern.toLowerCase();
  // Translate `*` into a non-greedy match of any character. We escape every other regex metacharacter to keep the
  // matcher precise — beatoraja's wildcards never use `?`/`[]`/etc., so `*` is the only special character we honor.
  const escaped = lower.replace(/[\\^$.+?()[\]{}|]/g, '\\$&').replace(/\*/g, '[^/]*');
  const re = new RegExp(`^${escaped}$`);
  return (candidate: string) => re.test(candidate);
}

/**
 * Look up the source path for a `source[]` entry, applying the user's `filepath[]` override when one is present.
 * Returns the canonical key in `files` (or `undefined` when nothing matched). When the path includes a wildcard and
 * no override is given, picks the first sorted match for determinism.
 */
export function resolveSourcePath(
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
  entryPath: string,
  sourcePath: string,
  filepathOverrides?: Readonly<Record<string, string>>,
  filepathSchema?: ReadonlyArray<{ name: string; path: string }>,
): string | undefined {
  // Honor explicit user override.
  if (filepathOverrides && filepathSchema) {
    for (const f of filepathSchema) {
      if (f.path === sourcePath) {
        const chosen = filepathOverrides[f.name];
        if (typeof chosen === 'string' && chosen.length > 0) {
          return resolveBeatorajaPath(files, entryPath, chosen);
        }
      }
    }
  }
  if (sourcePath.includes('*')) {
    const matches = expandBeatorajaWildcard(files, entryPath, sourcePath);
    return matches[0];
  }
  return resolveBeatorajaPath(files, entryPath, sourcePath);
}
