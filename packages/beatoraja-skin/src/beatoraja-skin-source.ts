// Source-asset bundling for beatoraja skins.
//
// `BeatorajaSkin.source` lists `(id, path)` pairs that other elements reference via numeric `src`. Paths may carry
// `*` wildcards or live one or two directories above the entry script — `resolveSourcePath` handles both. The
// renderer wants a flat "id → bytes" map so it can build its `Texture` cache up-front; `bundleBeatorajaSources`
// produces that map and surfaces unresolved entries as warnings instead of throwing.

import { dirname, normalizePath } from '@be-music/utils/core';
import { asLoadedBytes, lookupBytesCaseInsensitive } from './file-lookup.ts';
import type { BeatorajaSkinFileEntry } from './file-lookup.ts';
import { describeMissingWildcardDirectory, resolveSourcePath } from './beatoraja-skin-resolver.ts';
import type {
  BeatorajaSkinFilepath,
  BeatorajaSkinSource,
  BeatorajaSkinSourceId,
} from './beatoraja-skin-types.ts';

export interface BeatorajaSourceAsset {
  /** Source slot id — matches `image[].src`. May be numeric or a symbolic string. */
  id: BeatorajaSkinSourceId;
  /** Canonical case-corrected path inside the bundle. Useful for cache keys. */
  path: string;
  /** Decoded bytes, ready to feed into `Texture.from(...)` / `Image.decode`. */
  bytes: Uint8Array;
}

export interface BeatorajaUnresolvedSource {
  id: BeatorajaSkinSourceId;
  /** Original path string from `source[]` (preserved verbatim for diagnostics). */
  path: string;
  /** Why we couldn't resolve it. Populated for both "wildcard matched nothing" and "file not loadable". */
  reason: string;
}

export interface BeatorajaSourceBundle {
  /** All resolved `id → asset` pairs, ordered by declaration order. */
  assets: BeatorajaSourceAsset[];
  /** Quick lookup keyed by source id. */
  byId: Map<BeatorajaSkinSourceId, BeatorajaSourceAsset>;
  /** Sources whose path didn't resolve. Renderers fall back to a transparent texture for these. */
  unresolved: BeatorajaUnresolvedSource[];
}

export interface BundleBeatorajaSourcesOptions {
  /** Dropped theme files. Same map shape returned by `readFilesIntoBytesMap`. */
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>;
  /** Path of the skin entry — drives relative `path` resolution for every `source[]` entry. */
  entryPath: string;
  /** `source[]` array from a parsed skin. */
  sources: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Optional `filepath[]` schema, used together with {@link filepathOverrides} for user-picked alternates. */
  filepathSchema?: ReadonlyArray<BeatorajaSkinFilepath>;
  /** User selection per `filepath[].name`. */
  filepathOverrides?: Readonly<Record<string, string>>;
}

/**
 * Resolve every `source[]` entry's path and (when the entry's bytes have been loaded already) bundle them into a
 * renderer-ready map. Deferred file handles are reported as unresolved for now — the caller is expected to
 * pre-load image bytes via `readFilesIntoBytesMap({ deferAudio: true })` so that `.png`/`.jpg`/`.tga` arrive as
 * `Uint8Array`s by the time this runs.
 */
export function bundleBeatorajaSources(options: BundleBeatorajaSourcesOptions): BeatorajaSourceBundle {
  const assets: BeatorajaSourceAsset[] = [];
  const byId = new Map<BeatorajaSkinSourceId, BeatorajaSourceAsset>();
  const unresolved: BeatorajaUnresolvedSource[] = [];

  for (const raw of options.sources) {
    const source = coerceSource(raw);
    if (source === undefined) continue;

    const resolved = resolveSourcePath(
      options.files,
      options.entryPath,
      source.path,
      options.filepathOverrides,
      options.filepathSchema,
    );
    if (resolved === undefined) {
      // For wildcard misses, append the resolved search directory + how many entries the file
      // map has anywhere under that directory. This distinguishes the three failure modes the
      // user typically hits:
      //   - "search directory absent from drop"  → 0 nearby entries
      //   - "directory present but no `.png`s"   → N nearby entries, none matching the basename
      //   - "directory present, basename mismatch (typo / case)" → N nearby entries, hint at a sibling
      // Without the breadcrumb the warning just says "no files matched wildcard" and the user
      // can't tell which scenario they're in.
      const reason = source.path.includes('*')
        ? `no files matched wildcard '${source.path}'${describeMissingWildcardDirectory(options.files, options.entryPath, source.path)}`
        : `file not found: '${source.path}'`;
      unresolved.push({ id: source.id, path: source.path, reason });
      continue;
    }

    const entry = lookupBytesCaseInsensitive(options.files, resolved);
    const bytes = asLoadedBytes(entry);
    if (bytes === undefined) {
      unresolved.push({
        id: source.id,
        path: source.path,
        reason: `file '${resolved}' was deferred — pre-load image bytes before bundling sources`,
      });
      continue;
    }

    // Movie / video sources (audit 3.7). Beatoraja's `JSONSkinLoader.getSource` dispatches
    // `.mp4` / `.mov` / `.webm` / `.mkv` source paths to `SkinSourceMovie`. Our renderer
    // only handles static textures today — surface the file as unresolved with a clear
    // "movie sources not yet supported" reason so the host can warn the user (the wildcard
    // diagnostic reuses the same `unresolved` array so the call site doesn't need a separate
    // collection). Skins authoring movie sources stay otherwise functional; the matching
    // destination just hides instead of crashing on a non-image bind.
    if (isMovieSourcePath(resolved)) {
      unresolved.push({
        id: source.id,
        path: source.path,
        reason: `movie sources not yet supported (resolved to '${resolved}')`,
      });
      continue;
    }

    const asset: BeatorajaSourceAsset = { id: source.id, path: resolved, bytes };
    assets.push(asset);
    byId.set(source.id, asset);
  }

  return { assets, byId, unresolved };
}

function coerceSource(raw: Readonly<Record<string, unknown>>): BeatorajaSkinSource | undefined {
  const id = raw.id;
  const path = raw.path;
  // Accept both numeric ids (LR2-style `0..N`) and symbolic string ids (`"bg"`,
  // `"notes_src"`). Beatoraja's loader treats them interchangeably — `image[].src` and
  // `source[].id` carry whichever shape the skin author chose, and the renderer keys its
  // texture cache by the literal value (number or string). Earlier versions of this coercer
  // dropped string-id sources entirely, which made any community skin that exclusively used
  // string ids (e.g. GdbG_Skin) load no textures at all.
  if (typeof id !== 'number' && typeof id !== 'string') return undefined;
  if (typeof id === 'number' && !Number.isFinite(id)) return undefined;
  if (typeof id === 'string' && id.length === 0) return undefined;
  if (typeof path !== 'string' || path.length === 0) return undefined;
  return { id, path };
}

/**
 * Convenience: resolve every `source[]` path WITHOUT pulling bytes — useful when the host wants to enumerate
 * which files a skin will demand before paying the I/O cost. Returns `undefined` for entries that don't match
 * anything in `files`, and the canonical case-corrected path otherwise.
 *
 * `entryPath` accepts the same shape as {@link BundleBeatorajaSourcesOptions.entryPath}; the helper normalizes it
 * the same way the bundler does.
 */
/**
 * Detect movie / video extensions beatoraja's `JSONSkinLoader.getSource` would route through
 * `SkinSourceMovie`. Match upstream's set: `.mp4` / `.mov` / `.webm` / `.mkv` (case-insensitive
 * via lowercased compare). Returning `true` means our renderer will hide the destination
 * gracefully rather than crashing on a non-image bind.
 */
function isMovieSourcePath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm') || lower.endsWith('.mkv');
}

export function listBeatorajaSourcePaths(
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
  entryPath: string,
  sources: ReadonlyArray<Readonly<Record<string, unknown>>>,
  filepathSchema?: ReadonlyArray<BeatorajaSkinFilepath>,
  filepathOverrides?: Readonly<Record<string, string>>,
): Array<{ id: BeatorajaSkinSourceId; path: string; resolved: string | undefined }> {
  const normalizedEntry = normalizePath(entryPath);
  const baseDir = dirname(normalizedEntry);
  void baseDir; // Reserved for future per-id diagnostics; resolveSourcePath already takes the entry path.
  return sources
    .map(coerceSource)
    .filter((s): s is BeatorajaSkinSource => s !== undefined)
    .map((s) => ({
      id: s.id,
      path: s.path,
      resolved: resolveSourcePath(files, normalizedEntry, s.path, filepathOverrides, filepathSchema),
    }));
}
