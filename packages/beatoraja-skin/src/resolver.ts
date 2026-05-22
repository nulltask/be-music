// Path resolution for beatoraja skins.
//
// Inside a `.json` or `.luaskin` file every `path` field is relative to that skin file's directory. The path may
// also contain `*` wildcards (e.g. `play/background/*.png`) — beatoraja picks one matching file at random when the
// player hasn't chosen one explicitly via `filepath[]`. We resolve all of those here so consumers never need to know
// about the original path syntax.

import { basename, dirname, normalizePath } from '@be-music/utils/core';
import { findCaseInsensitivePath } from './file-lookup.ts';
import type { BeatorajaSkinFileEntry } from './file-lookup.ts';
import type { BeatorajaSkinHeader } from './types.ts';

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

/** One file entry inside a directory bucket of {@link BeatorajaPathIndex}. */
interface BeatorajaDirIndexEntry {
  readonly originalKey: string;
  readonly basenameLower: string;
}

interface BeatorajaPathIndex {
  /**
   * Files grouped by their lowercased parent directory. The root directory is keyed `''`. Each entry preserves the
   * original-case key (returned to callers as the canonical path) plus its precomputed lowercase basename so the
   * wildcard pattern match doesn't repeat the slicing per call.
   */
  readonly byDir: ReadonlyMap<string, readonly BeatorajaDirIndexEntry[]>;
}

/**
 * WeakMap-backed cache so each `files` map's directory index is built exactly once. The previous resolver iterated
 * `for (const key of files.keys()) { key.toLowerCase(); lastIndexOf('/'); slice(...) }` per wildcard expansion — every
 * `source[]` entry in `bundleBeatorajaSources` (dozens per skin) triggered a full O(allFiles) scan that re-lowered
 * every key and recomputed the same parent-dir slice on every call.
 */
const beatorajaPathIndexCache: WeakMap<ReadonlyMap<string, unknown>, BeatorajaPathIndex> = new WeakMap();

function getBeatorajaPathIndex(files: ReadonlyMap<string, BeatorajaSkinFileEntry>): BeatorajaPathIndex {
  const cacheKey = files as ReadonlyMap<string, unknown>;
  const cached = beatorajaPathIndexCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const byDir = new Map<string, BeatorajaDirIndexEntry[]>();
  for (const originalKey of files.keys()) {
    const lowerKey = originalKey.toLowerCase();
    const lastSlash = lowerKey.lastIndexOf('/');
    const dirLower = lastSlash >= 0 ? lowerKey.slice(0, lastSlash) : '';
    const basenameLower = lastSlash >= 0 ? lowerKey.slice(lastSlash + 1) : lowerKey;
    const entry: BeatorajaDirIndexEntry = { originalKey, basenameLower };
    const bucket = byDir.get(dirLower);
    if (bucket) {
      bucket.push(entry);
    } else {
      byDir.set(dirLower, [entry]);
    }
  }
  const index: BeatorajaPathIndex = { byDir };
  beatorajaPathIndexCache.set(cacheKey, index);
  return index;
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

  // Bucket lookup by the precomputed directory index avoids re-scanning the whole files map and re-lowering every key
  // on each call — drops the cost from O(allFiles) per wildcard to O(filesInTargetDir).
  const bucket = getBeatorajaPathIndex(files).byDir.get(dirPartLower);
  if (!bucket) {
    return [];
  }
  const matches: string[] = [];
  for (let i = 0; i < bucket.length; i += 1) {
    const entry = bucket[i]!;
    if (matcher(entry.basenameLower)) {
      matches.push(entry.originalKey);
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
 * Build a default `file` map (the {@link BeatorajaSkinConfig.file} field) by walking every
 * `header.filepath[]` entry and resolving each `def` against the wildcard's match set.
 *
 * Beatoraja themes use `def` to declare the author's preferred default file inside a wildcard
 * folder — e.g. ModernChic's `key` filepath has `def = "harf"` to point at `harf.png` even
 * though `#default.png` sorts earlier alphabetically. Without this seed the host's
 * `BeatorajaSkinConfig.file` starts empty (`{}`), the wildcard fallback inside
 * `resolveSourcePath` fires, and authors that intended a non-alphabetic default see whichever
 * filename happens to sort first instead.
 *
 * Matching:
 *
 *   1. Expand the entry's wildcard against the file map (sorted lexicographically by
 *      `expandBeatorajaWildcard`).
 *   2. Look for a candidate whose filename stem (basename without extension) matches `def`
 *      EXACTLY first, then with case-insensitive comparison as a fallback so Windows-authored
 *      themes with mixed-case `def` still resolve.
 *   3. Skip the entry when `def` is missing / empty, the wildcard expanded to nothing, or no
 *      candidate matched — `resolveSourcePath`'s wildcard fallback then fires for that entry.
 *
 * Returns the picked CANONICAL path string for each filepath name (matching the values the
 * skin-options panel stores). Entries without a resolved default simply don't appear in the
 * returned record.
 */
export function buildDefaultSkinConfigFiles(
  header: Pick<BeatorajaSkinHeader, 'filepath'>,
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
  entryPath: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(header.filepath)) return out;
  for (const fp of header.filepath) {
    if (fp === null || typeof fp !== 'object') continue;
    if (typeof fp.name !== 'string' || fp.name.length === 0) continue;
    if (typeof fp.path !== 'string' || fp.path.length === 0) continue;
    if (typeof fp.def !== 'string' || fp.def.length === 0) continue;
    const candidates = expandBeatorajaWildcard(files, entryPath, fp.path);
    if (candidates.length === 0) continue;
    const matched = pickCandidateByStem(candidates, fp.def);
    if (matched !== undefined) out[fp.name] = matched;
  }
  return out;
}

/**
 * Locate the candidate path whose filename stem matches `def`. Stem extraction strips ONLY the
 * last extension (e.g. `diamond SCUROed..png` → `diamond SCUROed.`) so authors who use trailing
 * dots in their filenames still match correctly. Tries case-sensitive equality first, then
 * case-insensitive — Windows-authored themes occasionally drift case between `def` and the
 * actual filename.
 */
function pickCandidateByStem(candidates: ReadonlyArray<string>, def: string): string | undefined {
  const exact = candidates.find((path) => stemOf(path) === def);
  if (exact !== undefined) return exact;
  const defLower = def.toLowerCase();
  return candidates.find((path) => stemOf(path).toLowerCase() === defLower);
}

function stemOf(path: string): string {
  const name = basename(path);
  const dotIdx = name.lastIndexOf('.');
  return dotIdx > 0 ? name.slice(0, dotIdx) : name;
}

/**
 * Look up the source path for a `source[]` entry, applying the user's `filepath[]` override when one is present.
 * Returns the canonical key in `files` (or `undefined` when nothing matched). When the path includes a wildcard and
 * no override is given, picks the first sorted match for determinism.
 *
 * Override-path resolution accepts BOTH canonical (full files-map key) and relative (skin-entry-relative)
 * inputs. {@link buildDefaultSkinConfigFiles} and the skin-options panel's user picks both produce canonical
 * paths (matching upstream beatoraja's Java side, which stores absolute disk paths in `config.json`); we try
 * those as direct lookups first, falling back to {@link resolveBeatorajaPath}'s base-dir-prepend for any
 * caller that stored relative paths (hand-edited config payloads, future API changes). Without the canonical
 * branch, every wildcard source gated by a `filepath[]` entry resolves to `undefined` because the canonical
 * path gets re-prepended with `dirname(entryPath)` and lands at a non-existent doubled key — most of
 * ModernChic's chrome textures (bg / judge / keybeam / bomb / glow / ...) hit this path.
 */
export function resolveSourcePath(
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
  entryPath: string,
  sourcePath: string,
  filepathOverrides?: Readonly<Record<string, string>>,
  filepathSchema?: ReadonlyArray<{ name: string; path: string }>,
): string | undefined {
  // Honor explicit user override. Lua skins frequently authored as `filepath = {}` historically
  // came through as `{}` (record) instead of `[]` (array) — guard against any non-iterable value
  // here so a malformed schema doesn't crash the source bundler. (We also fixed the upstream Lua
  // → JS conversion to default empty tables to arrays, but skins reading from JSON or hand-built
  // configs still hit this path with arbitrary shapes.)
  if (filepathOverrides && Array.isArray(filepathSchema)) {
    for (const f of filepathSchema) {
      if (f.path === sourcePath) {
        const chosen = filepathOverrides[f.name];
        if (typeof chosen === 'string' && chosen.length > 0) {
          // Canonical path branch — direct files-map lookup. Wins for the common case where
          // the host stored a canonical path (every default-pick + every user pick today).
          const direct = findCaseInsensitivePath(files, normalizePath(chosen));
          if (direct !== undefined) return direct;
          // Relative-path fallback — defends against hand-edited config payloads or future
          // API shifts that emit relative paths. `resolveBeatorajaPath` does the base-dir
          // prepend that breaks canonical inputs but works correctly for relative ones.
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

/**
 * Build a parenthesized diagnostic suffix explaining WHY a wildcard expansion returned nothing.
 * The unresolved-source warning concatenates this onto the user-facing message so the next
 * reproduction is self-diagnostic — the warning alone tells the user whether their drop is
 * missing the directory entirely vs. the basename pattern just doesn't match.
 *
 * Output shape, joined by `; ` inside parentheses:
 *
 *   - " (resolved dir: <abs>; <N> files under that dir; closest siblings: a, b, c)"
 *
 * `closest siblings` lists up to 3 lexicographically-earliest entries inside the resolved
 * directory. Bounded so a directory with hundreds of assets doesn't dominate the log line.
 *
 * Returns the empty string when the input path doesn't include a wildcard — callers should
 * gate on that themselves, but the no-op fallback keeps the helper safe to use unconditionally.
 */
export function describeMissingWildcardDirectory(
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
  entryPath: string,
  relative: string,
): string {
  if (!relative.includes('*')) return '';
  const baseDir = dirname(normalizePath(entryPath));
  const fullGlob = baseDir.length > 0 ? `${baseDir}/${relative}` : relative;
  const normalizedGlob = normalizePath(fullGlob);
  const slashIdx = normalizedGlob.lastIndexOf('/');
  const dirPart = slashIdx >= 0 ? normalizedGlob.slice(0, slashIdx) : '';
  const dirPartLower = dirPart.toLowerCase();
  const insidePrefix = `${dirPartLower}/`;

  // Reuse the precomputed directory index: `bucket` is the list of files directly inside the resolved directory, and
  // every other bucket whose `dirLower` starts with `${dirPartLower}/` lives under the resolved tree. This replaces
  // two full `for (const key of files.keys())` scans with one pass over the much-smaller set of unique directories.
  const index = getBeatorajaPathIndex(files);
  const insideBucket = index.byDir.get(dirPartLower);
  const insideDir: string[] = insideBucket ? insideBucket.map((entry) => entry.originalKey) : [];
  let underTree = insideDir.length;
  for (const [otherDir, bucket] of index.byDir) {
    if (otherDir === dirPartLower) continue;
    if (otherDir === dirPartLower || otherDir.startsWith(insidePrefix)) {
      underTree += bucket.length;
    }
  }

  if (insideDir.length === 0 && underTree === 0) {
    return ` (search dir '${dirPart}' absent from drop)`;
  }
  insideDir.sort();
  const sample = insideDir.slice(0, 3).map((p) => p.slice(p.lastIndexOf('/') + 1));
  return ` (search dir '${dirPart}'; ${insideDir.length} sibling file(s), ${underTree} entries under tree; samples: ${sample.join(', ')})`;
}
