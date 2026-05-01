import { Texture, Assets } from 'pixi.js';
import { parseLr2Font, type Lr2BitmapFont } from './lr2-font.ts';
import type { Lr2LoadedFont } from './lr2-bitmap-text.ts';
import { readDxaArchive } from './lr2-dxa.ts';
import { decodeTga, isTgaImage } from './lr2-tga.ts';
import { normalizePath } from './library.ts';

/**
 * Loads every `#LR2FONT,n,path` declared by a parsed skin into
 * runtime `Lr2LoadedFont` payloads.
 *
 * Each declared path can resolve to either:
 *
 * - A bare `.lr2font` text file (with sibling PNGs / BMPs) — the
 *   most permissive path; works as long as the user has extracted
 *   the LR2 default theme's `.dxa` archives ahead of time using
 *   the bundled `DxaDecode.exe`.
 * - A `.dxa` archive containing the `.lr2font` plus its images —
 *   we attempt to read it, but DXA decryption isn't implemented
 *   yet so encrypted archives (the LR2 default theme bundles)
 *   silently fall through to the system-font path.
 *
 * Failures are non-fatal: the returned map only contains fonts
 * that loaded successfully. Missing entries make
 * `makeLr2TextSprite` use the system-font fallback for that font
 * index, which still produces readable text.
 */
export async function loadSkinBitmapFonts(
  fontPaths: ReadonlyArray<string>,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<Map<number, Lr2LoadedFont>> {
  const out = new Map<number, Lr2LoadedFont>();
  await Promise.all(
    fontPaths.map(async (path, index) => {
      if (path.length === 0) return;
      const loaded = await tryLoadFont(path, files);
      if (loaded) out.set(index, loaded);
    }),
  );
  return out;
}

async function tryLoadFont(
  declaredPath: string,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<Lr2LoadedFont | undefined> {
  const lower = declaredPath.toLowerCase();
  const direct = lookupCaseInsensitive(files, declaredPath);
  if (lower.endsWith('.dxa')) {
    if (!direct) return undefined;
    return loadFontFromDxa(direct, declaredPath);
  }
  if (lower.endsWith('.lr2font')) {
    if (!direct) return undefined;
    return loadFontFromBareFile(direct, declaredPath, files);
  }
  // Some themes name the path without an extension. Try both
  // common siblings before giving up.
  const dxa = lookupCaseInsensitive(files, `${declaredPath}.dxa`);
  if (dxa) return loadFontFromDxa(dxa, declaredPath);
  const lr2font = lookupCaseInsensitive(files, `${declaredPath}.lr2font`);
  if (lr2font) return loadFontFromBareFile(lr2font, declaredPath, files);
  return undefined;
}

async function loadFontFromBareFile(
  bytes: Uint8Array,
  fontPath: string,
  files: ReadonlyMap<string, Uint8Array>,
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
    // Encrypted or unsupported DXA — bail and let the host fall
    // back to system-font / placeholder rendering. Logged once at
    // INFO so themes shipping unsupported archives don't noisy the
    // console for every render.
    // eslint-disable-next-line no-console
    console.info(`[lr2-font] DXA decode skipped (likely encrypted): ${fontPath}`);
    return undefined;
  }
  // Build an in-archive lookup map so the .lr2font's relative
  // image references resolve to extracted bytes.
  const archiveFiles = new Map<string, Uint8Array>();
  for (const file of archive.files) {
    archiveFiles.set(normalizePath(file.path).toLowerCase(), file.data);
  }
  const lr2FontFile = archive.files.find((file) => file.path.toLowerCase().endsWith('.lr2font'));
  if (!lr2FontFile) return undefined;
  const text = decodeText(lr2FontFile.data);
  if (!text) return undefined;
  const font = parseLr2Font(text);
  const textures = await loadFontTextures(font, (relPath) => {
    const normalized = normalizePath(relPath).toLowerCase();
    return archiveFiles.get(normalized);
  });
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
  // TGA branch — browsers don't natively decode TrueVision Targa,
  // so we run our own decoder and upload the raw RGBA pixels via
  // `createImageBitmap`. The LR2 default theme ships every font
  // texture as `.tga`, so this is the hot path for that bundle.
  if (ext === 'tga' || isTgaImage(bytes)) {
    return loadTgaTexture(bytes, relPath);
  }
  // Pixi v8 `Assets.load` accepts a URL — we mint an in-memory
  // blob URL so the loader's WebGL upload pipeline is reused. We
  // intentionally don't revoke the blob URL: the texture's
  // `source` keeps a reference to it for the lifetime of the
  // skin, and revoking would break re-decode on context loss.
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'bmp' ? 'image/bmp' : 'image/png';
  // Copy into a fresh `ArrayBuffer` — `bytes.buffer` may be a
  // `SharedArrayBuffer` view (when the bytes came through a
  // worker), and `Blob` only accepts plain `ArrayBuffer` parts.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const texture = await Assets.load<Texture>(url);
    return texture;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[lr2-font] failed to decode ${relPath}`, error);
    return undefined;
  }
}

async function loadTgaTexture(bytes: Uint8Array, relPath: string): Promise<Texture | undefined> {
  const decoded = decodeTga(bytes);
  if (!decoded) {
    // eslint-disable-next-line no-console
    console.warn(`[lr2-font] failed to decode TGA ${relPath}`);
    return undefined;
  }
  // Wrap the raw pixels in `ImageData`, then either rasterize via
  // `createImageBitmap` (browser fast path) or paint to an
  // OffscreenCanvas. Returns `undefined` if the runtime exposes
  // neither (Node test environments).
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  // Paint the decoded RGBA pixels onto an offscreen canvas via
  // `putImageData`, then hand the canvas to Pixi as a texture
  // source. Using `OffscreenCanvas` (rather than mounting a DOM
  // `<canvas>`) keeps the load path off the main thread / DOM.
  const canvas = new OffscreenCanvas(decoded.width, decoded.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  // Construct ImageData via the ctx helper (`createImageData`) so
  // we get a runtime-correct constructor regardless of the lib
  // version, then copy the decoded pixels into its `data` slot.
  const imageData = ctx.createImageData(decoded.width, decoded.height);
  imageData.data.set(decoded.data);
  ctx.putImageData(imageData, 0, 0);
  return Texture.from(canvas as unknown as HTMLCanvasElement);
}

function decodeText(bytes: Uint8Array): string | undefined {
  // `.lr2font` files are SHIFT-JIS in practice (FontUtil's output
  // uses the LR2-era default codepage). Fall back to UTF-8 so a
  // hand-edited UTF-8 file still parses.
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
  // `.lr2font` references use Windows conventions (`..\foo\bar.png`).
  // Normalize to forward slashes and resolve `.` / `..` segments
  // against `base`.
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

function lookupCaseInsensitive(files: ReadonlyMap<string, Uint8Array>, path: string): Uint8Array | undefined {
  const direct = files.get(path);
  if (direct) return direct;
  const target = normalizePath(path).toLowerCase();
  for (const [key, value] of files) {
    if (normalizePath(key).toLowerCase() === target) return value;
  }
  return undefined;
}
