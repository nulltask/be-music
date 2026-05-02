import { Texture, VideoSource } from 'pixi.js';
import { resolveLr2AssetBytes, type Lr2Skin } from './lr2-skin.ts';

/**
 * Result of `loadVideoTextureFromBytes`. The texture is a Pixi
 * `Texture` whose source is a `VideoSource` wrapping the same
 * `<video>` element returned alongside it. Callers seek / play the
 * video element directly to drive frame updates; the Pixi source
 * polls `requestVideoFrameCallback` (or a rAF fallback) to push
 * fresh frames into the GL texture.
 *
 * The associated `objectUrl` is created from the bytes' `Blob` and
 * MUST be revoked (via `URL.revokeObjectURL`) once the texture is
 * disposed to free the underlying memory.
 */
export interface VideoTextureHandle {
  texture: Texture;
  video: HTMLVideoElement;
  objectUrl: string;
}

/**
 * Loads a video file (`mp4` / `webm` / etc.) into a Pixi `Texture`
 * backed by an HTML `<video>` element. The video starts paused and
 * muted — the caller is expected to seek + `.play()` it on cue.
 *
 * Falls back to {@link transcodeVideoToBrowserCodec} (via libav /
 * ffmpeg.wasm) when the browser refuses to decode the original
 * bytes — typical for legacy BMS BGA shipping `.mpg` / MPEG-1
 * containers that no modern browser plays natively. The
 * transcode pass writes a temporary H.264 / yuv420p MP4 in
 * memory and feeds that back through the same `<video>` path,
 * so the rest of the BGA pipeline (Pixi `VideoSource`, frame
 * polling) is identical regardless of whether a transcode
 * happened.
 *
 * Returns `undefined` only when both the native decode AND the
 * libav fallback fail — at that point we accept the asset is
 * unplayable and the BGA preloader simply skips it.
 */
export async function loadVideoTextureFromBytes(
  path: string,
  bytes: Uint8Array,
): Promise<VideoTextureHandle | undefined> {
  const direct = await tryLoadVideoTextureFromBytes(path, bytes);
  if (direct) return direct;
  // eslint-disable-next-line no-console
  console.info(`[bga-video] native decode failed; falling back to ffmpeg.wasm transcode: ${path}`);
  const transcoded = await transcodeVideoToBrowserCodec(bytes, path).catch((error) => {
    // eslint-disable-next-line no-console
    console.warn(`[bga-video] transcode failed: ${path}`, error);
    return undefined;
  });
  if (!transcoded) return undefined;
  // The transcoded payload is always MP4 / H.264; pass an
  // explicit name so `guessVideoMimeType` picks `video/mp4` and
  // the browser's H.264 decoder takes the fast path.
  return tryLoadVideoTextureFromBytes(`${stripVideoExtension(path)}.transcoded.mp4`, transcoded);
}

async function tryLoadVideoTextureFromBytes(
  path: string,
  bytes: Uint8Array,
): Promise<VideoTextureHandle | undefined> {
  const blob = new Blob([new Uint8Array(bytes)], { type: guessVideoMimeType(path) });
  const objectUrl = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.src = objectUrl;
  // BMS BGA video has no soundtrack of its own — audio comes from
  // `#WAV` samples on the chart timeline. Muting also lets some
  // browsers skip the autoplay-policy gating since silent media is
  // exempt.
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  // `loop` is left at false — BGA cues drive when the video starts;
  // looping would replay forever after the cue ends, which doesn't
  // match BMS semantics.
  video.loop = false;

  try {
    await waitForVideoMetadata(video, 5000);
  } catch {
    releaseVideoElement(video);
    URL.revokeObjectURL(objectUrl);
    return undefined;
  }

  const source = new VideoSource({ resource: video, autoPlay: false, autoLoad: true });
  // BGA video should look as the artist authored it; nearest-pixel
  // sampling matches our per-skin default for low-res BGA frames
  // and avoids the smeary look the GPU's bilinear gives on 256x256
  // BMS-spec frames scaled up to 800px+ playfields.
  source.scaleMode = 'nearest';
  source.label = path;
  const texture = new Texture({ source });
  texture.label = path;
  return { texture, video, objectUrl };
}

/**
 * Lazy-imports libav.js (ffmpeg.wasm) and remuxes / re-encodes
 * `bytes` to MP4 / H.264 / yuv420p — the lowest-common-denominator
 * codec every modern browser plays natively. The libav module is
 * a multi-megabyte WASM bundle, so the import is intentionally
 * deferred to here: a typical drop with only modern BGA video
 * never pays the download cost.
 *
 * `noworker: true` keeps everything on the main thread so the
 * dev-server doesn't need to ship the COOP / COEP headers a
 * worker-based libav build would otherwise require. Transcoding
 * is CPU-bound but happens during the BGA prepare phase (which
 * already overlaps the Decide splash), so the user never sees a
 * frozen frame waiting for it.
 */
async function transcodeVideoToBrowserCodec(
  bytes: Uint8Array,
  path: string,
): Promise<Uint8Array | undefined> {
  const startedAt = performance.now();
  // eslint-disable-next-line no-console
  console.info(`[bga-video] transcode start: ${path} (${bytes.byteLength} bytes)`);
  const ffmpeg = await loadFfmpeg().catch((error) => {
    // eslint-disable-next-line no-console
    console.warn('[bga-video] failed to load ffmpeg.wasm — BGA video will be skipped', error);
    return undefined;
  });
  if (!ffmpeg) return undefined;
  const inputName = `bga-input${pickInputExtension(path)}`;
  const outputName = 'bga-output.mp4';
  try {
    await ffmpeg.writeFile(inputName, bytes);
    // Single-pass libx264 transcode. Flags chosen for browser
    // compatibility:
    //   - `-c:v libx264 -pix_fmt yuv420p` — universally decoded
    //   - `-preset ultrafast` / `-crf 26` — speed over file size
    //     (the output is throwaway, only kept while the chart is
    //     mounted)
    //   - `-an` — strip audio; BMS BGA never carries an audio
    //     track that should drive playback (chart audio comes
    //     from `#WAV` cues)
    //   - `-movflags +faststart` — moov atom up front so the
    //     `<video>` element can start decoding before the whole
    //     MP4 finishes downloading (we read the whole buffer
    //     anyway, but the flag is free)
    // Speed-over-quality flags — keep the input resolution &
    // framerate intact (the user asked for visual parity), but
    // tune libx264 itself for the fastest possible encode:
    //
    //   - `-preset ultrafast` skips most analysis passes.
    //   - `-tune fastdecode,zerolatency` further drops
    //     bidirectional prediction.
    //   - `-threads 0` lets libx264 pick the worker count from
    //     the core-mt thread pool — the big multi-core win.
    //   - `-crf 30` trades a notch of quality for speed; BGA
    //     art tolerates it cleanly under nearest-filter scaling.
    const exitCode = await ffmpeg.exec([
      '-y',
      '-i',
      inputName,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'fastdecode,zerolatency',
      '-crf',
      '30',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '0',
      '-an',
      '-movflags',
      '+faststart',
      outputName,
    ]);
    if (exitCode !== 0) {
      // eslint-disable-next-line no-console
      console.warn(`[bga-video] ffmpeg exited with code ${exitCode} for ${path}`);
      return undefined;
    }
    const out = await ffmpeg.readFile(outputName);
    let outBytes: Uint8Array | undefined;
    if (out instanceof Uint8Array) {
      outBytes = out;
    } else if (typeof out === 'string') {
      // ffmpeg.readFile can return string when no encoding is
      // overridden — coerce via TextEncoder so we always return
      // raw bytes downstream.
      outBytes = new TextEncoder().encode(out);
    }
    if (!outBytes || outBytes.byteLength === 0) {
      // eslint-disable-next-line no-console
      console.warn(`[bga-video] ffmpeg produced empty output for ${path}`);
      return undefined;
    }
    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(2);
    // eslint-disable-next-line no-console
    console.info(`[bga-video] transcode ok: ${path} → ${outBytes.byteLength} bytes (${elapsed}s)`);
    return outBytes;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[bga-video] transcode threw for ${path}`, error);
    return undefined;
  } finally {
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {
      // ignore — the in-memory FS lives only as long as the
      // FFmpeg instance, which we leak between calls (see
      // `loadFfmpeg` for why) so cleanup just keeps the VFS
      // tidy across calls.
    }
    try {
      await ffmpeg.deleteFile(outputName);
    } catch {
      // ignore
    }
  }
}

/**
 * Lazy-loaded singleton — the `FFmpeg` class boots a Worker that
 * downloads + instantiates the ~30 MB `@ffmpeg/core` wasm. We
 * keep the loaded instance around between calls so subsequent
 * BGA videos transcode immediately instead of paying the cold-
 * start hit on every chart change.
 */
let cachedFfmpeg: FfmpegInstance | undefined;
let cachedFfmpegPromise: Promise<FfmpegInstance> | undefined;

async function loadFfmpeg(): Promise<FfmpegInstance> {
  if (cachedFfmpeg) return cachedFfmpeg;
  if (cachedFfmpegPromise) return cachedFfmpegPromise;
  cachedFfmpegPromise = (async () => {
    // Lazy ESM imports keep the multi-megabyte wasm + worker
    // bundle out of the initial page load — the user only pays
    // the download cost when they actually pick a chart with an
    // unsupported BGA video.
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import('@ffmpeg/ffmpeg'),
      import('@ffmpeg/util'),
    ]);
    // `@ffmpeg/core-mt` is the multi-threaded build: ffmpeg
    // runs on a worker pool that uses SharedArrayBuffer to
    // parallelise libx264 across CPU cores. Cuts BMS BGA
    // transcode time from ~tens of seconds to a few seconds
    // on a typical multi-core CPU. Requires the page to be
    // cross-origin isolated (COOP / COEP — see the demo's
    // `vite.config.ts`).
    //
    // We deliberately target the UMD entry from the host's
    // `/ffmpeg-core-mt/` static path: the pthread workers
    // Emscripten spawns load the core as a classic script via
    // `importScripts`, which trips on the ESM entry's top-
    // level `import` statements with `Uncaught SyntaxError:
    // Cannot use import statement outside a module`. The UMD
    // package exports aren't routed through `package.json`'s
    // `exports` field (Vite can't resolve
    // `@ffmpeg/core-mt/dist/umd/...?url` cleanly), so the demo
    // copies the UMD files into `public/ffmpeg-core-mt/` via
    // `vite-plugin-static-copy` and we reference them by their
    // served URLs here.
    const baseUrl = '/ffmpeg-core-mt';
    const coreUrl = `${baseUrl}/ffmpeg-core.js`;
    const wasmUrl = `${baseUrl}/ffmpeg-core.wasm`;
    const workerUrl = `${baseUrl}/ffmpeg-core.worker.js`;
    const ffmpeg = new FFmpeg();
    // `toBlobURL` re-fetches the core JS / WASM / worker URLs
    // into blob URLs so the spawned Worker can `importScripts`
    // them even when the page sits behind a different origin
    // (the Worker's same-origin policy otherwise blocks the
    // cross-origin file URLs Vite hands out under HMR).
    const [coreBlobUrl, wasmBlobUrl, workerBlobUrl] = await Promise.all([
      toBlobURL(coreUrl, 'text/javascript'),
      toBlobURL(wasmUrl, 'application/wasm'),
      toBlobURL(workerUrl, 'text/javascript'),
    ]);
    await ffmpeg.load({ coreURL: coreBlobUrl, wasmURL: wasmBlobUrl, workerURL: workerBlobUrl });
    cachedFfmpeg = ffmpeg as FfmpegInstance;
    return cachedFfmpeg;
  })().catch((error) => {
    // Reset the promise cache on failure so a transient
    // network blip doesn't permanently disable the fallback.
    cachedFfmpegPromise = undefined;
    throw error;
  });
  return cachedFfmpegPromise;
}

interface FfmpegInstance {
  writeFile(path: string, data: Uint8Array): Promise<boolean>;
  readFile(path: string): Promise<Uint8Array | string>;
  exec(args: string[]): Promise<number>;
  deleteFile(path: string): Promise<boolean>;
}

function pickInputExtension(path: string): string {
  const lower = path.toLowerCase();
  // Preserve the original extension so libav picks the right
  // demuxer (`.mpg` → mpegps, `.avi` → avi, `.wmv` → asf, …).
  const dotIndex = lower.lastIndexOf('.');
  if (dotIndex < 0) return '.mpg';
  const ext = lower.slice(dotIndex);
  // Allow only a small allowlist of known video extensions to
  // avoid passing arbitrary user-controlled strings into the
  // VFS path.
  if (['.mpg', '.mpeg', '.avi', '.wmv', '.mov', '.mp4', '.webm', '.mkv', '.ogv', '.ogg'].includes(ext)) {
    return ext;
  }
  return '.mpg';
}

function stripVideoExtension(path: string): string {
  const dotIndex = path.lastIndexOf('.');
  if (dotIndex < 0) return path;
  return path.slice(0, dotIndex);
}

function releaseVideoElement(video: HTMLVideoElement): void {
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch {
    // Defensive: detached / unsupported media elements can throw on load().
  }
}

function waitForVideoMetadata(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
      window.clearTimeout(timeoutHandle);
    };
    const onLoaded = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error('video error'));
    };
    const timeoutHandle = window.setTimeout(() => {
      cleanup();
      reject(new Error('video metadata timeout'));
    }, timeoutMs);
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
  });
}

function guessVideoMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.ogv') || lower.endsWith('.ogg')) return 'video/ogg';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  // Older BMS archives sometimes ship `.mpg` / `.mpeg` / `.avi` /
  // `.wmv` — modern browsers won't decode those so the video element
  // will fire `error` and `loadVideoTextureFromBytes` returns
  // `undefined`. We still tag a sensible MIME type so the rare
  // browser-supported codec works.
  if (lower.endsWith('.mpg') || lower.endsWith('.mpeg')) return 'video/mpeg';
  return 'video/mp4';
}

export interface LoadTextureOptions {
  /** Skin-declared `#TRANSCOLOR` chroma key (rare on BGA assets, common on UI sprites). */
  transparentColor?: { r: number; g: number; b: number };
  /**
   * Treat pure-black pixels as transparent. Mirrors the BMS BGA "layer"
   * convention (`packages/player/src/bga.ts`'s `isOpaquePixel` for `mode
   * === 'layer'`): the foreground BGA layer is composited over the base
   * with `(0, 0, 0)` acting as a chroma-key. Only enabled for layer-track
   * decodes — base / POOR retain their black pixels because they're the
   * bottommost BGA layer (nothing visible behind them).
   */
  keyOutBlack?: boolean;
}

/**
 * Loads any LR2 / BGA asset (TGA, PNG, BMP, JPG, …) into a PixiJS
 * `Texture`. Branches by file extension because TGA isn't decoded by
 * `createImageBitmap` in any browser.
 *
 * The legacy positional `transparentColor` argument is supported for
 * backward compatibility — pass an `LoadTextureOptions` object for the
 * full feature set (`keyOutBlack`, future flags).
 */
export async function loadTextureFromBytes(
  path: string,
  bytes: Uint8Array,
  transparentColorOrOptions?: { r: number; g: number; b: number } | LoadTextureOptions,
): Promise<Texture | undefined> {
  const options = normalizeLoadTextureOptions(transparentColorOrOptions);
  if (path.toLowerCase().endsWith('.tga')) {
    return decodeTgaTexture(bytes, options, path);
  }
  const blob = new Blob([new Uint8Array(bytes)]);
  return loadTextureFromBlob(blob, path, options);
}

/**
 * Resolves an LR2 skin asset (image, font sheet, etc.) to a Pixi
 * texture using the skin's bundled file map. Honours the skin's
 * `#TRANSCOLOR` chroma key.
 */
export async function loadSkinAssetTexture(skin: Lr2Skin, path: string): Promise<Texture | undefined> {
  const bytes = resolveLr2AssetBytes(skin, path);
  if (!bytes) {
    return undefined;
  }
  return loadTextureFromBytes(path, bytes, skin.transparentColor);
}

function normalizeLoadTextureOptions(
  input: { r: number; g: number; b: number } | LoadTextureOptions | undefined,
): LoadTextureOptions {
  if (!input) {
    return {};
  }
  // The legacy positional `transparentColor` shape has flat `r/g/b`
  // numbers; the new options shape has a nested `transparentColor` /
  // `keyOutBlack`. Discriminate on `r` so call sites that still pass
  // the bare color triple keep working without a typed cast.
  if (typeof (input as { r?: unknown }).r === 'number') {
    return { transparentColor: input as { r: number; g: number; b: number } };
  }
  return input as LoadTextureOptions;
}

async function loadTextureFromBlob(
  blob: Blob,
  label?: string,
  options: LoadTextureOptions = {},
): Promise<Texture | undefined> {
  try {
    const imageBitmap = await createImageBitmap(blob);
    let finalBitmap = imageBitmap;
    if (options.transparentColor || options.keyOutBlack) {
      const keyedBitmap = await applyChromaKeyToBitmap(imageBitmap, options);
      if (keyedBitmap) {
        imageBitmap.close();
        finalBitmap = keyedBitmap;
      }
    }
    let texture: Texture;
    try {
      texture = Texture.from(finalBitmap);
    } catch (error) {
      finalBitmap.close();
      throw error;
    }
    // Force nearest-neighbour sampling on every loaded texture. LR2
    // skin / BGA assets are pixel-art; bilinear filtering blurs them
    // when the design space is scaled up to the canvas. Mirrors the
    // user-requested "disable all interpolation / AA" policy.
    texture.source.scaleMode = 'nearest';
    if (label) {
      texture.label = label;
      texture.source.label = label;
    }
    return texture;
  } catch {
    return undefined;
  }
}

async function applyChromaKeyToBitmap(
  imageBitmap: ImageBitmap,
  options: LoadTextureOptions,
): Promise<ImageBitmap | undefined> {
  const canvas = document.createElement('canvas');
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return undefined;
  }
  context.drawImage(imageBitmap, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const transparent = options.transparentColor;
  const keyOutBlack = options.keyOutBlack === true;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index] ?? 0;
    const g = data[index + 1] ?? 0;
    const b = data[index + 2] ?? 0;
    if (transparent && r === transparent.r && g === transparent.g && b === transparent.b) {
      data[index + 3] = 0;
      continue;
    }
    if (keyOutBlack && r === 0 && g === 0 && b === 0) {
      data[index + 3] = 0;
    }
  }
  context.putImageData(imageData, 0, 0);
  return createImageBitmap(canvas);
}

async function decodeTgaTexture(
  bytes: Uint8Array,
  options: LoadTextureOptions = {},
  label?: string,
): Promise<Texture | undefined> {
  const transparentColor = options.transparentColor;
  const keyOutBlack = options.keyOutBlack === true;
  if (bytes.length < 18) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idLength = bytes[0] ?? 0;
  const colorMapType = bytes[1] ?? 0;
  const imageType = bytes[2] ?? 0;
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const bitsPerPixel = bytes[16] ?? 0;
  const descriptor = bytes[17] ?? 0;
  const bytesPerPixel = bitsPerPixel / 8;
  const isRle = imageType === 10 || imageType === 11;
  const isTrueColor = imageType === 2 || imageType === 10;
  const isGrayscale = imageType === 3 || imageType === 11;

  if (
    colorMapType !== 0 ||
    width <= 0 ||
    height <= 0 ||
    !Number.isInteger(bytesPerPixel) ||
    !((isTrueColor && (bitsPerPixel === 24 || bitsPerPixel === 32)) || (isGrayscale && bitsPerPixel === 8))
  ) {
    return undefined;
  }

  const pixelCount = width * height;
  const imageData = new ImageData(width, height);
  const topOrigin = (descriptor & 0x20) !== 0;
  const rightOrigin = (descriptor & 0x10) !== 0;
  let sourceOffset = 18 + idLength;
  let written = 0;

  const writePixel = (source: number): boolean => {
    if (source + bytesPerPixel > bytes.length || written >= pixelCount) {
      return false;
    }
    const sourceX = written % width;
    const sourceY = Math.floor(written / width);
    const x = rightOrigin ? width - 1 - sourceX : sourceX;
    const y = topOrigin ? sourceY : height - 1 - sourceY;
    const target = (y * width + x) * 4;
    if (isGrayscale) {
      const value = bytes[source] ?? 0;
      imageData.data[target] = value;
      imageData.data[target + 1] = value;
      imageData.data[target + 2] = value;
      imageData.data[target + 3] = 255;
    } else {
      const r = bytes[source + 2] ?? 0;
      const g = bytes[source + 1] ?? 0;
      const b = bytes[source] ?? 0;
      let a = bitsPerPixel === 32 ? (bytes[source + 3] ?? 255) : 255;
      if (transparentColor && r === transparentColor.r && g === transparentColor.g && b === transparentColor.b) {
        a = 0;
      } else if (keyOutBlack && r === 0 && g === 0 && b === 0) {
        a = 0;
      }
      imageData.data[target] = r;
      imageData.data[target + 1] = g;
      imageData.data[target + 2] = b;
      imageData.data[target + 3] = a;
    }
    written += 1;
    return true;
  };

  if (isRle) {
    while (written < pixelCount && sourceOffset < bytes.length) {
      const packet = bytes[sourceOffset++] ?? 0;
      const count = (packet & 0x7f) + 1;
      if ((packet & 0x80) !== 0) {
        const pixelOffset = sourceOffset;
        sourceOffset += bytesPerPixel;
        for (let index = 0; index < count; index += 1) {
          if (!writePixel(pixelOffset)) {
            return undefined;
          }
        }
      } else {
        for (let index = 0; index < count; index += 1) {
          if (!writePixel(sourceOffset)) {
            return undefined;
          }
          sourceOffset += bytesPerPixel;
        }
      }
    }
  } else {
    while (written < pixelCount) {
      if (!writePixel(sourceOffset)) {
        return undefined;
      }
      sourceOffset += bytesPerPixel;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return undefined;
  }
  context.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    return undefined;
  }
  return loadTextureFromBlob(blob, label);
}
