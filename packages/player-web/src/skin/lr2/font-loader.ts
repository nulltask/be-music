import { Texture, Assets } from 'pixi.js';
import {
  decodeTga,
  isTgaImage,
  parseLr2Font,
  readDxaArchive,
  type Lr2BitmapFont,
  type Lr2SkinFileEntry,
} from '@be-music/lr2-skin';
import type { Lr2LoadedFont } from './bitmap-text.ts';
import { normalizePath } from '../../collection/collection.ts';
import { attachBlobUrlToTexture } from './textures.ts';
import { logger } from '../../logger.ts';

const log = logger('lr2-font');

/**
 * Loads every `#LR2FONT,n,path` declared by a parsed skin into runtime `Lr2LoadedFont` payloads.
 *
 * Each declared path can resolve to either:
 *
 * - A bare `.lr2font` text file (with sibling PNGs / BMPs) — the most permissive path; works as long as the user has
 *   extracted the LR2 default theme's `.dxa` archives ahead of time using the bundled `DxaDecode.exe`.
 * - A `.dxa` archive containing the `.lr2font` plus its images — we attempt to read it, but DXA decryption isn't
 *   implemented yet so encrypted archives (the LR2 default theme bundles) silently fall through to the system-font
 *   path.
 *
 * Failures are non-fatal: the returned map only contains fonts that loaded successfully. Missing entries make
 * `makeLr2TextSprite` use the system-font fallback for that font index, which still produces readable text.
 */
export async function loadSkinBitmapFonts(
  fontPaths: ReadonlyArray<string>,
  files: ReadonlyMap<string, Lr2SkinFileEntry>,
): Promise<Map<number, Lr2LoadedFont>> {
  const declared = fontPaths.filter((path) => path.length > 0).length;
  log.info(`start: ${declared}/${fontPaths.length} non-empty font slots, ${files.size} files in source`);
  const out = new Map<number, Lr2LoadedFont>();
  await Promise.all(
    fontPaths.map(async (path, index) => {
      if (path.length === 0) return;
      const loaded = await tryLoadFont(path, files);
      if (loaded) out.set(index, loaded);
    }),
  );
  log.info(`done: loaded ${out.size}/${declared} bitmap fonts`);
  return out;
}

async function tryLoadFont(
  declaredPath: string,
  files: ReadonlyMap<string, Lr2SkinFileEntry>,
): Promise<Lr2LoadedFont | undefined> {
  const lower = declaredPath.toLowerCase();
  const direct = lookupCaseInsensitive(files, declaredPath);
  // Direct hit on a `.dxa` declaration.
  if (lower.endsWith('.dxa')) {
    if (!direct) {
      log.info(`miss: declared .dxa not found in source: ${declaredPath}`);
      return undefined;
    }
    return loadFontFromDxa(direct, declaredPath);
  }
  // Direct hit on a bare `.lr2font` text file (already-extracted theme).
  if (lower.endsWith('.lr2font') && direct) {
    return loadFontFromBareFile(direct, declaredPath, files);
  }
  // LR2 default-theme convention: skin CSV references e.g. `Select/optionfont/font.lr2font` even though no such
  // directory exists — the actual content sits inside `Select/optionfont.dxa`. LR2 strips the trailing
  // `<basename>/<basename>.lr2font` suffix and tries the `.dxa` next to it. We mirror that here.
  if (lower.endsWith('.lr2font')) {
    const archivePath = collapseLr2FontDirectoryToDxa(declaredPath);
    if (archivePath) {
      const archiveBytes = lookupCaseInsensitive(files, archivePath);
      if (archiveBytes) return loadFontFromDxa(archiveBytes, archivePath);
      log.info(`miss: collapsed-dir .dxa not found: ${declaredPath} → tried ${archivePath}`);
    }
  }
  // Some themes name the path without an extension. Try both common siblings before giving up.
  const dxa = lookupCaseInsensitive(files, `${declaredPath}.dxa`);
  if (dxa) return loadFontFromDxa(dxa, declaredPath);
  const lr2font = lookupCaseInsensitive(files, `${declaredPath}.lr2font`);
  if (lr2font) return loadFontFromBareFile(lr2font, declaredPath, files);
  // Nothing matched — emit a diagnostic listing the candidate paths we tried so the user can match against their actual
  // file layout. The most common cause is a filename-encoding mismatch (Shift-JIS path in the CSV vs. UTF-8 keys in the
  // source files map) or a directory-loader that skipped binary files entirely.
  log.info(
    `miss: no matching file for declared path "${declaredPath}" ` +
      `(tried direct, collapsed .dxa, suffix .dxa, suffix .lr2font)`,
  );
  return undefined;
}

/**
 * Returns the `.dxa` archive path corresponding to LR2's "directory-pretending-to-be-an-archive" convention. The skin
 * CSV references e.g. `Select/optionfont/font.lr2font` and LR2, when the directory doesn't exist, falls back to
 * `Select/optionfont.dxa` (the parent directory's name becomes the archive name; the leaf `.lr2font` filename is
 * whatever the archive packs internally).
 */
function collapseLr2FontDirectoryToDxa(declaredPath: string): string | undefined {
  const normalized = declaredPath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) return undefined;
  return `${normalized.slice(0, lastSlash)}.dxa`;
}

async function loadFontFromBareFile(
  bytes: Uint8Array,
  fontPath: string,
  files: ReadonlyMap<string, Lr2SkinFileEntry>,
): Promise<Lr2LoadedFont | undefined> {
  const text = decodeText(bytes);
  if (!text) return undefined;
  const font = parseLr2Font(text);
  const fontDir = directoryOf(fontPath);
  const textures = await loadFontTextures(font, (relPath) => {
    const resolved = joinRelative(fontDir, relPath);
    return lookupCaseInsensitive(files, resolved);
  });
  return { font, textures };
}

async function loadFontFromDxa(bytes: Uint8Array, fontPath: string): Promise<Lr2LoadedFont | undefined> {
  const archive = readDxaArchive(bytes);
  if (!archive) {
    // Decode failed — most often because the archive is encrypted (the LR2 default theme bundles use a non-default key
    // we can't recover) or because the format isn't a DXA V3 we recognize. The renderer falls back to system-font /
    // placeholder text so the scene is still legible. Logged once per font path at INFO since this is expected on
    // user-shipped themes; not a warning.
    log.info(`DXA decode failed: ${fontPath} (encrypted or unsupported)`);
    return undefined;
  }
  // Build an in-archive lookup map so the .lr2font's relative image references resolve to extracted bytes.
  const archiveFiles = new Map<string, Uint8Array>();
  for (const file of archive.files) {
    archiveFiles.set(normalizePath(file.path).toLowerCase(), file.data);
  }
  const lr2FontFile = archive.files.find((file) => file.path.toLowerCase().endsWith('.lr2font'));
  if (!lr2FontFile) {
    log.info(`DXA decoded OK but contained no .lr2font: ${fontPath}`);
    return undefined;
  }
  const text = decodeText(lr2FontFile.data);
  if (!text) {
    log.info(`DXA .lr2font text decode failed: ${fontPath}`);
    return undefined;
  }
  const font = parseLr2Font(text);
  const textures = await loadFontTextures(font, (relPath) => {
    const normalized = normalizePath(relPath).toLowerCase();
    return archiveFiles.get(normalized);
  });
  // Success path — log so the user can confirm which fonts came through the DXA pipeline at runtime. Also emits the
  // texture count, which is the easiest cue when a font decodes but its sibling images don't (zero textures → glyphs
  // fall back to placeholder rectangles even though the layout is correct).
  log.info(`DXA decoded OK: ${fontPath} (${archive.files.length} entries, ${textures.size} textures)`);
  return { font, textures };
}

async function loadFontTextures(
  font: Lr2BitmapFont,
  resolver: (relativePath: string) => Uint8Array | undefined,
): Promise<Map<number, Texture>> {
  const out = new Map<number, Texture>();
  await Promise.all(
    [...font.images.entries()].map(async ([gr, relPath]) => {
      const bytes = resolver(relPath);
      if (!bytes) return;
      const texture = await loadTextureFromBytes(bytes, relPath);
      if (texture) out.set(gr, texture);
    }),
  );
  return out;
}

async function loadTextureFromBytes(bytes: Uint8Array, relPath: string): Promise<Texture | undefined> {
  const ext = (relPath.toLowerCase().split('.').pop() ?? 'png').replace(/[^a-z0-9]/g, '');
  // TGA branch — browsers don't natively decode TrueVision Targa, so we run our own decoder and upload the raw RGBA
  // pixels via `createImageBitmap`. The LR2 default theme ships every font texture as `.tga`, so this is the hot path
  // for that bundle.
  if (ext === 'tga' || isTgaImage(bytes)) {
    return loadTgaTexture(bytes, relPath);
  }
  // Pixi v8 `Assets.load` accepts a URL — we mint an in-memory blob URL so the loader's WebGL upload pipeline is
  // reused. The URL is *not* revoked synchronously after the upload because the texture's `<img>` source keeps a
  // reference to it for the lifetime of the GPU upload (and for re-decode on a WebGL context-loss event); revoking
  // here would break those redirects. Instead we stamp the URL onto the texture via `attachBlobUrlToTexture` so
  // `destroyTextureAndRevokeBlobUrl` (used by `destroyUniqueTextures` and the LR2 texture stores) can revoke the URL
  // when the texture is finally torn down.
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'bmp' ? 'image/bmp' : 'image/png';
  // Copy into a fresh `ArrayBuffer` — `bytes.buffer` may be a `SharedArrayBuffer` view (when the bytes came through a
  // worker), and `Blob` only accepts plain `ArrayBuffer` parts.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const texture = await Assets.load<Texture>(url);
    attachBlobUrlToTexture(texture, url);
    return texture;
  } catch (error) {
    log.warn(`failed to decode ${relPath}`, error);
    URL.revokeObjectURL(url);
    return undefined;
  }
}

async function loadTgaTexture(bytes: Uint8Array, relPath: string): Promise<Texture | undefined> {
  const decoded = decodeTga(bytes);
  if (!decoded) {
    log.warn(`failed to decode TGA ${relPath}`);
    return undefined;
  }
  // Wrap the raw pixels in `ImageData`, then either rasterize via `createImageBitmap` (browser fast path) or paint to
  // an OffscreenCanvas. Returns `undefined` if the runtime exposes neither (Node test environments).
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  // Paint the decoded RGBA pixels onto an offscreen canvas via `putImageData`, then hand the canvas to Pixi as a
  // texture source. Using `OffscreenCanvas` (rather than mounting a DOM `<canvas>`) keeps the load path off the main
  // thread / DOM.
  const canvas = new OffscreenCanvas(decoded.width, decoded.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  // Construct ImageData via the ctx helper (`createImageData`) so we get a runtime-correct constructor regardless of
  // the lib version, then copy the decoded pixels into its `data` slot.
  const imageData = ctx.createImageData(decoded.width, decoded.height);
  imageData.data.set(decoded.data);
  ctx.putImageData(imageData, 0, 0);
  return Texture.from(canvas as unknown as HTMLCanvasElement);
}

function decodeText(bytes: Uint8Array): string | undefined {
  // `.lr2font` files are SHIFT-JIS in practice (FontUtil's output uses the LR2-era default codepage). Fall back to
  // UTF-8 so a hand-edited UTF-8 file still parses.
  try {
    const sjis = new TextDecoder('shift-jis', { fatal: false }).decode(bytes);
    if (looksLikeFontText(sjis)) return sjis;
  } catch {
    // not available in the runtime — fall through
  }
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return undefined;
  }
}

function looksLikeFontText(text: string): boolean {
  return /^\s*#[STMR]\b/m.test(text);
}

function directoryOf(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash >= 0 ? path.slice(0, slash) : '';
}

function joinRelative(base: string, rel: string): string {
  // `.lr2font` references use Windows conventions (`..\foo\bar.png`). Normalize to forward slashes and resolve `.` /
  // `..` segments against `base`.
  const segments = `${base}/${rel}`.replace(/\\/g, '/').split('/');
  const stack: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  return stack.join('/');
}

function lookupCaseInsensitive(files: ReadonlyMap<string, Lr2SkinFileEntry>, path: string): Uint8Array | undefined {
  const direct = asLoadedBytes(files.get(path));
  if (direct) return direct;
  const target = normalizePath(path).toLowerCase();
  for (const [key, value] of files) {
    if (normalizePath(key).toLowerCase() === target) {
      const bytes = asLoadedBytes(value);
      if (bytes) return bytes;
    }
  }
  // Suffix-match fallback. Common case: the user dropped the `LR2beta3/` parent folder, so file keys look like
  // `LR2beta3/LR2files/Theme/LR2/Select/barfnt.dxa` while the skin CSV declares `LR2files/Theme/LR2/Select/barfnt.dxa`.
  // Treat any key that ends with `/<target>` as a match. Among multiple candidates we pick the shortest — the one whose
  // extra prefix is the smallest, which is the most-specific mount under the user-dropped root.
  const suffix = `/${target}`;
  let bestKey: string | undefined;
  let bestValue: Uint8Array | undefined;
  for (const [key, value] of files) {
    const norm = normalizePath(key).toLowerCase();
    if (!norm.endsWith(suffix)) continue;
    const bytes = asLoadedBytes(value);
    if (!bytes) continue;
    if (bestKey === undefined || key.length < bestKey.length) {
      bestKey = key;
      bestValue = bytes;
    }
  }
  return bestValue;
}

function asLoadedBytes(entry: Lr2SkinFileEntry | undefined): Uint8Array | undefined {
  return entry instanceof Uint8Array ? entry : undefined;
}
