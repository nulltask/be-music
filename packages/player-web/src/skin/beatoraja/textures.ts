// PixiJS texture cache for a beatoraja skin's `source[]` bundle.
//
// IMPORTANT: the cache has no `dispose()` by design. `texture.destroy(true)` followed by a fresh decode of the
// same bytes makes PixiJS v8 hand back a half-disposed `TextureSource` (`style = null`) from its internal source
// pool, then crash inside `_createBindGroup` (WebGPU) / `applyStyleParams` (WebGL2) on the next render. The host
// memoizes the cache per entry path so we never need to destroy; trade-off is up to a few tens of MB resident
// per fully-previewed theme, cleared on page reload.

import { Texture } from 'pixi.js';
import type { BeatorajaSkinSourceId, BeatorajaSourceAsset, BeatorajaSourceBundle } from '@be-music/beatoraja-skin';
import { runWithConcurrency } from '@be-music/utils/core';
import { logger } from '../../logger.ts';

const log = logger('beatoraja-tex');

const TEXTURE_DECODE_CONCURRENCY = 4;

export interface BeatorajaTextureCache {
  /**
   * `source[].id` → loaded Pixi Texture. Missing ids return `undefined`. Beatoraja allows both
   * numeric (`0`, `1`, …) and symbolic-string ids (`"bg"`, `"notes_src"`, …); both flavors are
   * keyed verbatim, so `cache.get(7)` and `cache.get("bg")` look up different slots.
   */
  get(sourceId: BeatorajaSkinSourceId): Texture | undefined;
  /** All loaded textures. Useful for renderer warm-up steps that need to upload everything to the GPU. */
  values(): IterableIterator<Texture>;
  /** Per-id source path (canonical case-corrected key from the file map). */
  pathOf(sourceId: BeatorajaSkinSourceId): string | undefined;
}

/**
 * Build a PixiJS texture cache from an already-resolved {@link BeatorajaSourceBundle}. Each asset's bytes are
 * wrapped in a `Blob`, decoded via `createImageBitmap`, and uploaded to the GPU as a `Texture`. Failures (corrupt
 * image bytes, browser-side decode error) log a warning and leave the slot unset — the renderer falls back to a
 * transparent texture.
 */
export async function loadBeatorajaTexturesFromBundle(bundle: BeatorajaSourceBundle): Promise<BeatorajaTextureCache> {
  const textures = new Map<BeatorajaSkinSourceId, Texture>();
  const paths = new Map<BeatorajaSkinSourceId, string>();

  await runWithConcurrency(bundle.assets, TEXTURE_DECODE_CONCURRENCY, async (asset) => {
    try {
      const texture = await decodeAsset(asset);
      textures.set(asset.id, texture);
      paths.set(asset.id, asset.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`failed to decode source[${asset.id}] '${asset.path}': ${message}`);
    }
  });

  return {
    get: (sourceId) => textures.get(sourceId),
    values: () => textures.values(),
    pathOf: (sourceId) => paths.get(sourceId),
  };
}

/**
 * Conservative cap for source bitmap dimensions. WebGPU adapters typically max out at 16384 px;
 * we pick a slightly-lower bound (16000) so we never have to second-guess whether the device
 * was actually granted the higher limit at request time. Bitmaps that exceed this dimension are
 * down-scaled to fit BEFORE upload so the GPU never sees an over-budget texture.
 *
 * Some authored beatoraja skins ship enormous bitmap-font atlases (e.g. GdbG_Skin's
 * `fonts/bitmap/Title_*.png` is 8000×12000). 12000 fits inside 16000 with `requiredLimits` set,
 * but a future-proof skin that ships a 17000-px atlas would still need the down-scale path.
 */
const MAX_TEXTURE_DIMENSION_PX = 16000;

async function decodeAsset(asset: BeatorajaSourceAsset): Promise<Texture> {
  // The `Uint8Array<ArrayBuffer>` cast keeps Blob on the zero-copy path; mirrors the LR2 loader.
  const blob = new Blob([asset.bytes as Uint8Array<ArrayBuffer>]);
  let bitmap = await createImageBitmap(blob);
  if (bitmap.width > MAX_TEXTURE_DIMENSION_PX || bitmap.height > MAX_TEXTURE_DIMENSION_PX) {
    bitmap = await downscaleBitmap(bitmap, MAX_TEXTURE_DIMENSION_PX, asset.path);
  }
  const texture = Texture.from(bitmap);
  // `scaleMode = 'nearest'` is for pixel-art correctness AND has a side effect we depend on: it eagerly
  // initializes the texture's `style`, dodging a `addressModeU` null-deref the WebGL2 / WebGPU bind-group
  // setup hits if the source's first render pass arrives before any style assignment.
  texture.source.scaleMode = 'nearest';
  texture.label = asset.path;
  texture.source.label = asset.path;
  return texture;
}

/**
 * Re-encode an oversized bitmap into a smaller one that fits within the GPU texture-size
 * envelope. Aspect ratio is preserved; the longer dimension is clamped to `maxDim` and the
 * shorter dimension scales proportionally. Uses an `OffscreenCanvas` when available (workers /
 * modern browsers) and falls back to a DOM `HTMLCanvasElement` otherwise.
 *
 * The downscale is "best effort" — if the canvas API isn't available we throw, which the
 * caller catches and logs as a per-asset decode failure (the texture slot stays empty,
 * matching the behavior for corrupt source bytes). Text destinations using a downscaled
 * bitmap-font atlas will look slightly blurrier than the authored asset, but the runtime
 * stays stable instead of crashing on the WebGPU bind-group validation error.
 */
async function downscaleBitmap(bitmap: ImageBitmap, maxDim: number, label: string): Promise<ImageBitmap> {
  const scale = Math.min(maxDim / bitmap.width, maxDim / bitmap.height);
  const targetW = Math.max(1, Math.floor(bitmap.width * scale));
  const targetH = Math.max(1, Math.floor(bitmap.height * scale));
  log.warn(
    `texture '${label}' is ${bitmap.width}×${bitmap.height} (exceeds ${maxDim}px GPU limit) — downscaling to ${targetW}×${targetH}`,
  );
  // Prefer OffscreenCanvas (no DOM dependency, works in workers and avoids triggering layout).
  // Fall back to the global HTMLCanvasElement when the platform doesn't expose OffscreenCanvas.
  let drawn: ImageBitmap;
  if (typeof globalThis !== 'undefined' && typeof globalThis.OffscreenCanvas !== 'undefined') {
    const canvas = new globalThis.OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      bitmap.close();
      throw new Error(`OffscreenCanvas 2d context unavailable for '${label}'`);
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();
    drawn = await createImageBitmap(canvas);
  } else if (typeof globalThis !== 'undefined' && typeof globalThis.document !== 'undefined') {
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      bitmap.close();
      throw new Error(`Canvas 2d context unavailable for '${label}'`);
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();
    drawn = await createImageBitmap(canvas);
  } else {
    bitmap.close();
    throw new Error(`Canvas API unavailable — cannot downscale '${label}'`);
  }
  return drawn;
}
