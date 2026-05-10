// Skin font loader for beatoraja `.luaskin` / `.json` themes.
//
// The skin's top-level `font[]` declares per-id font paths. Skins ship two flavors:
//   1. **TTF / OTF** — registered via the document's `FontFace` registry; consumed by Pixi `Text`
//      through CSS `font-family`.
//   2. **AngelCode `.fnt` (BMFont, text format)** — pre-rendered glyph atlas; parsed into a Pixi
//      `BitmapFont` and registered in Pixi's runtime cache; consumed by `BitmapText` through the
//      same `style.fontFamily` channel.
//
// Both branches surface the same per-id `(font-family, kind)` tuple so the skin view can pick the
// right `Text` / `BitmapText` constructor without needing to know how the font was loaded. Failures
// (path missing, decode error, parser hiccup) are logged and skipped — the cache lookup returns
// `undefined` and the consumer falls back to platform sans-serif via Pixi `Text`.
//
// Why BMFont matters: many community themes (e.g. GroundbreakinG) ship hand-tuned bitmap fonts for
// title / artist / score displays. Without BMFont support every label collapses to sans-serif and
// the design's intended metrics fall apart. Browsers can't load `.fnt` through `FontFace` (the
// magic bytes don't pass OpenType validation — OTS rejects them with `invalid sfntVersion`), so the
// loader has to detect the format and route to Pixi's BMFont stack instead.

import {
  asLoadedBytes,
  loadAssetBytes,
  resolveBeatorajaPath,
  type BeatorajaSkinFontId,
  type BeatorajaSkinFileEntry,
} from '@be-music/beatoraja-skin';
import { BitmapFont, Cache, Texture, bitmapFontTextParser } from 'pixi.js';
import { logger } from './logger.ts';

const log = logger('beatoraja-fonts');

/** What rendering pipe a loaded font is bound to. Drives the skin view's `Text` vs `BitmapText` pick. */
export type BeatorajaFontKind = 'css' | 'bitmap';

export interface BeatorajaLoadedFont {
  /** Author-declared font slot id from `font[].id`. */
  id: BeatorajaSkinFontId;
  /**
   * `font-family` name that addresses this font:
   * - `kind: 'css'` → the family registered with `document.fonts`. Used in `style.fontFamily`.
   * - `kind: 'bitmap'` → the key the Pixi runtime cache holds the `BitmapFont` under (the value
   *   stored in the cache is keyed `${family}-bitmap`, but `BitmapText.style.fontFamily` takes the
   *   bare family name and Pixi appends `-bitmap` internally).
   */
  family: string;
  /** Resolved path inside the dropped file map. Used for diagnostics. */
  path: string;
  /** Which Pixi text class to render with. */
  kind: BeatorajaFontKind;
}

export interface BeatorajaFontCache {
  /** Returns the registered family name for a font id, or `undefined` when the slot wasn't loaded. */
  family(id: BeatorajaSkinFontId): string | undefined;
  /** Returns the rendering kind for a loaded slot, or `undefined` when the slot wasn't loaded. */
  kind(id: BeatorajaSkinFontId): BeatorajaFontKind | undefined;
  /** All successfully-loaded fonts, in declaration order. */
  values(): ReadonlyArray<BeatorajaLoadedFont>;
}

/**
 * Load every `font[]` declaration into the appropriate registry — `document.fonts` for TTF/OTF or
 * Pixi's `Cache` for AngelCode `.fnt`. Each font gets a unique `font-family` name
 * (`beatoraja-skin-<entry>-<id>`) so concurrent skins don't clobber each other's registrations.
 *
 * Failures (path not found, unsupported format, decode error) are logged and skipped — the matching
 * lookup returns `undefined`, and the consumer falls back to the platform sans-serif via `Text`.
 */
export async function loadBeatorajaFonts(options: {
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>;
  entryPath: string;
  fonts: ReadonlyArray<{ id: BeatorajaSkinFontId; path: string }>;
}): Promise<BeatorajaFontCache> {
  const out = new Map<BeatorajaSkinFontId, BeatorajaLoadedFont>();
  const familyPrefix = `beatoraja-skin-${stableEntryHash(options.entryPath)}`;
  // CSS-side prerequisites only matter for the FontFace branch. The BMFont branch needs Pixi's
  // runtime cache, which exists in any environment that loaded `pixi.js` — tests use jsdom which
  // doesn't ship `FontFace`, so guard the CSS branch and let BMFonts continue loading.
  const canRegisterCssFont =
    typeof globalThis !== 'undefined' &&
    typeof FontFace !== 'undefined' &&
    typeof document !== 'undefined' &&
    'fonts' in document;
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
      const family = `${familyPrefix}-${fontIdFamilySuffix(decl.id)}`;
      if (isAngelCodeFntPath(resolved)) {
        const loaded = await registerBitmapFont({
          declId: decl.id,
          family,
          fntPath: resolved,
          fntBytes: bytes,
          files: options.files,
        });
        if (loaded !== undefined) out.set(decl.id, loaded);
        return;
      }
      if (!canRegisterCssFont) return;
      try {
        // Copy to a fresh, non-shared `ArrayBuffer`. The dropped-file map can hand back a
        // `Uint8Array<SharedArrayBuffer>` (some browsers' file readers return one), and
        // `FontFace`'s constructor signature only accepts a plain `ArrayBuffer`. Slicing the typed
        // array materializes a regular `ArrayBuffer` regardless of the source.
        const buffer = bytes.slice().buffer as ArrayBuffer;
        const face = new FontFace(family, buffer);
        await face.load();
        document.fonts.add(face);
        out.set(decl.id, { id: decl.id, family, path: resolved, kind: 'css' });
      } catch (error) {
        log.warn(`font[${decl.id}] '${resolved}': failed to register`, error);
      }
    }),
  );
  return makeCache(out);
}

function makeCache(map: Map<BeatorajaSkinFontId, BeatorajaLoadedFont>): BeatorajaFontCache {
  return {
    family: (id) => map.get(id)?.family,
    kind: (id) => map.get(id)?.kind,
    values: () => Array.from(map.values()),
  };
}

function fontIdFamilySuffix(id: BeatorajaSkinFontId): string {
  return typeof id === 'number' ? String(id) : `s-${stableEntryHash(id)}`;
}

/** Identify AngelCode BMFont declarations by file extension — text-format `.fnt` is the only flavor we ship. */
function isAngelCodeFntPath(path: string): boolean {
  return path.toLowerCase().endsWith('.fnt');
}

/**
 * Decode a `.fnt` file (text-format AngelCode BMFont), resolve its `page[].file` entries to page
 * textures from the dropped file map, build a `BitmapFont`, and register it in Pixi's runtime
 * cache under the `${family}-bitmap` key (matching what `BitmapText` looks up internally).
 *
 * Why we don't use Pixi's `loadBitmapFont`: that loader assumes the page images live behind a URL
 * the asset loader can fetch. Our pages live as `Uint8Array` in the dropped-file map, so we mirror
 * the same five steps (parse → resolve pages → decode → construct → cache) without going through
 * the asset URL machinery.
 */
async function registerBitmapFont(args: {
  declId: BeatorajaSkinFontId;
  family: string;
  fntPath: string;
  fntBytes: Uint8Array;
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>;
}): Promise<BeatorajaLoadedFont | undefined> {
  // BMFont text format is ASCII / Latin-1 — TextDecoder defaults to UTF-8 which is a strict
  // superset for the printable subset BMFont uses, so this is safe even when the file was authored
  // on Windows with code-page 1252 line endings (the parser tolerates `\r\n`).
  let parsed: ReturnType<typeof bitmapFontTextParser.parse>;
  try {
    const text = new TextDecoder('utf-8').decode(args.fntBytes);
    if (!bitmapFontTextParser.test(text)) {
      log.warn(`font[${args.declId}] '${args.fntPath}': not a recognized BMFont text format`);
      return undefined;
    }
    parsed = bitmapFontTextParser.parse(text);
  } catch (error) {
    log.warn(`font[${args.declId}] '${args.fntPath}': failed to parse`, error);
    return undefined;
  }

  // BMFont's `pages[]` lists page-image filenames relative to the `.fnt` file's directory. Resolve
  // each through the dropped-file map and decode to a Pixi `Texture`. Skip pages that fail to load
  // — a partially-decoded font still renders most glyphs.
  const pageTextures: Texture[] = [];
  for (let i = 0; i < parsed.pages.length; i += 1) {
    const page = parsed.pages[i];
    if (page === undefined) continue;
    const resolvedPagePath = resolveBeatorajaPath(args.files, args.fntPath, page.file);
    if (resolvedPagePath === undefined) {
      log.warn(`font[${args.declId}] page '${page.file}': not found relative to '${args.fntPath}'`);
      continue;
    }
    const pageEntry = args.files.get(resolvedPagePath);
    const pageBytes = asLoadedBytes(pageEntry) ?? (await loadAssetBytes(pageEntry));
    if (pageBytes === undefined) {
      log.warn(`font[${args.declId}] page '${resolvedPagePath}': bytes not available`);
      continue;
    }
    try {
      // Same Blob → ImageBitmap → Texture path the source-bundle decoder uses, so the visual
      // result is consistent with how skin sources render.
      const blob = new Blob([pageBytes as Uint8Array<ArrayBuffer>]);
      const bitmap = await createImageBitmap(blob);
      const texture = Texture.from(bitmap);
      texture.label = resolvedPagePath;
      texture.source.label = resolvedPagePath;
      pageTextures.push(texture);
    } catch (error) {
      log.warn(`font[${args.declId}] page '${resolvedPagePath}': failed to decode`, error);
    }
  }
  if (pageTextures.length === 0) {
    log.warn(`font[${args.declId}] '${args.fntPath}': no page textures decoded — abandoning font`);
    return undefined;
  }

  try {
    // Override `fontFamily` on the parsed data so the cache key matches our skin-prefixed family
    // (the parser fills it from the `info face=` line, which collides across skins). The resulting
    // BitmapFont reads its identity from this field.
    //
    // Normalize `fontSize` to its absolute value to mirror upstream's *effective* behavior.
    //
    // AngelCode BMFont's `info size=N` line uses the sign as a UNIT HINT — POSITIVE = points,
    // NEGATIVE = pixels — and the generator embeds that sign in the `.fnt` output verbatim.
    // GroundbreakinG's `Title.fnt` ships `size=-120` ("120 pixel glyphs"), and skins targeting
    // it pair the convention by authoring `text.size = -118` to match.
    //
    // Upstream `SkinTextBitmap.SkinTextBitmapSource.createCacheableFont` parses the `size=N` value
    // verbatim into `originalSize` (the negative is preserved), and `SkinTextBitmap.draw` line 59
    // computes `scale = this.size / originalSize`. Because BOTH `this.size` (= `text.size`) and
    // `originalSize` carry the same sign, the negatives CANCEL at scale time and produce a
    // positive ratio (`-118 / -120 = +0.983`). Final rendered glyph height ends up
    // `|originalSize| * scale ≈ |text.size|` px.
    //
    // Pixi's `bitmapFontTextParser` likewise carries the literal `-120` straight into
    // `BitmapFont.baseMeasurementFontSize`, but `getBitmapTextLayout` computes
    // `scale = style.fontSize / baseMeasurementFontSize` — and Pixi's TextStyle treats
    // `fontSize` as an unsigned magnitude (a negative input has no well-defined meaning in the
    // CSS/canvas pipelines `Text` and `BitmapText` share). We can't pass through a negative
    // `style.fontSize` to reproduce upstream's double-negative cancellation, so we sign-strip
    // BOTH sides instead — `Math.abs(parsed.fontSize)` here, paired with `Math.abs(element.size)`
    // in `pixi-beatoraja-skin-view.ts`'s `buildTextEntry`. The result is mathematically
    // equivalent: `+118 / +120 = +0.983`, same scale, same rendered glyph height.
    //
    // User report: without this normalization, `style.fontSize = abs(text.size)` (the only
    // value Pixi will accept) divided by negative `parsed.fontSize` gave a NEGATIVE Pixi scale,
    // and `AbstractBitmapTextPipe` rendered the text 180° flipped (gdbg DECIDE's title and
    // artist appeared upside-down).
    const normalizedFontSize = Math.abs(parsed.fontSize);
    const data = { ...parsed, fontFamily: args.family, fontSize: normalizedFontSize };
    const font = new BitmapFont({ data, textures: pageTextures });
    // Pixi's `BitmapText` looks up `Cache.get(`${family}-bitmap`)` — register under that exact key.
    Cache.set(`${args.family}-bitmap`, font);
    // eslint-disable-next-line no-console
    console.log(
      '[beatoraja-fonts] bitmap font registered',
      JSON.stringify({
        id: args.declId,
        family: args.family,
        path: args.fntPath,
        pages: pageTextures.length,
        chars: Object.keys(parsed.chars).length,
        lineHeight: parsed.lineHeight,
        fontSize: normalizedFontSize,
        rawFontSize: parsed.fontSize,
      }),
    );
    return { id: args.declId, family: args.family, path: args.fntPath, kind: 'bitmap' };
  } catch (error) {
    log.warn(`font[${args.declId}] '${args.fntPath}': failed to construct BitmapFont`, error);
    return undefined;
  }
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
