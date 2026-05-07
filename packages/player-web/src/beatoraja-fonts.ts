// Skin font loader for beatoraja `.luaskin` / `.json` themes.
//
// The skin's top-level `font[]` declares per-id TTF paths. Without loading them, every text destination
// renders with the browser's default sans-serif — which on a Japanese theme means the title / artist
// labels render with whatever fallback font the platform happens to ship and the user's "the fonts look
// garbled" complaint, especially when the design relied on a specific bitmap-style sans-serif's metrics.
//
// We resolve each declared font's relative path through the skin's `files` map, register it with the
// document via `FontFace`, and surface the per-id `(font-family-name, status)` so the skin view can pick
// the right family name when constructing each `Text` node.

import { asLoadedBytes, loadAssetBytes, resolveBeatorajaPath, type BeatorajaSkinFileEntry } from '@be-music/beatoraja-skin';
import { logger } from './logger.ts';

const log = logger('beatoraja-fonts');

export interface BeatorajaLoadedFont {
  /** Author-declared font slot id from `font[].id`. */
  id: number;
  /**
   * `font-family` name registered with the document. Skin-prefixed so multiple themes' fonts can coexist
   * without colliding. `Text` elements use this directly in their `style.fontFamily`.
   */
  family: string;
  /** Resolved path inside the dropped file map, useful for diagnostics. */
  path: string;
}

export interface BeatorajaFontCache {
  /** Returns the registered family name for a font id, or `undefined` when the slot wasn't loaded. */
  family(id: number): string | undefined;
  /** All successfully-loaded fonts, in declaration order. */
  values(): ReadonlyArray<BeatorajaLoadedFont>;
}

/**
 * Load every `font[]` declaration into the document's font registry. Each font gets a unique
 * `font-family` name (`beatoraja-skin-<entry>-<id>`) so concurrent skins don't clobber each other's
 * registrations. Returns a cache the renderer queries by font id.
 *
 * Failures (path not found, unsupported format, decode error) are logged and skipped — the matching
 * `font-family` lookup returns `undefined`, and the consumer falls back to the platform sans-serif.
 *
 * Reuses already-registered families when called twice for the same `(entryPath, fontId)` so a chart
 * restart doesn't re-decode the TTF bytes.
 */
export async function loadBeatorajaFonts(options: {
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>;
  entryPath: string;
  fonts: ReadonlyArray<{ id: number; path: string }>;
}): Promise<BeatorajaFontCache> {
  const out = new Map<number, BeatorajaLoadedFont>();
  if (typeof globalThis === 'undefined' || typeof FontFace === 'undefined' || !('fonts' in document)) {
    // SSR / vitest jsdom / unsupported browser — return an empty cache. Text renders via the platform
    // sans-serif fallback, same as before this loader existed.
    return makeCache(out);
  }
  const familyPrefix = `beatoraja-skin-${stableEntryHash(options.entryPath)}`;
  await Promise.all(
    options.fonts.map(async (decl) => {
      const resolved = resolveBeatorajaPath(options.files, options.entryPath, decl.path);
      if (resolved === undefined) {
        log.warn(`font[${decl.id}] '${decl.path}': not found in dropped file map`);
        return;
      }
      const entry = options.files.get(resolved);
      // Fonts are typically eagerly loaded into the byte map (TTFs are tiny). If the entry was deferred,
      // pull it now — same `loadAssetBytes` helper the texture loader uses.
      const bytes = asLoadedBytes(entry) ?? (await loadAssetBytes(entry));
      if (bytes === undefined) {
        log.warn(`font[${decl.id}] '${resolved}': bytes not available`);
        return;
      }
      const family = `${familyPrefix}-${decl.id}`;
      try {
        // Copy to a fresh, non-shared `ArrayBuffer`. The dropped-file map can hand back a
        // `Uint8Array<SharedArrayBuffer>` (some browsers' file readers return one), and
        // `FontFace`'s constructor signature only accepts a plain `ArrayBuffer`. Slicing the typed
        // array materializes a regular `ArrayBuffer` regardless of the source.
        const buffer = bytes.slice().buffer as ArrayBuffer;
        const face = new FontFace(family, buffer);
        await face.load();
        document.fonts.add(face);
        out.set(decl.id, { id: decl.id, family, path: resolved });
      } catch (error) {
        log.warn(`font[${decl.id}] '${resolved}': failed to register`, error);
      }
    }),
  );
  return makeCache(out);
}

function makeCache(map: Map<number, BeatorajaLoadedFont>): BeatorajaFontCache {
  return {
    family: (id) => map.get(id)?.family,
    values: () => Array.from(map.values()),
  };
}

/**
 * Stable, dependency-free 32-bit hash of a path string. We only use it to derive a unique font-family
 * suffix per entry, so a real cryptographic hash is overkill — collision probability for the few dozen
 * entries a session loads is negligible. Pure JS so the build doesn't pull in `node:crypto`.
 */
function stableEntryHash(path: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i += 1) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
