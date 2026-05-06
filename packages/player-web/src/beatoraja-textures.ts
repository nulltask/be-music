// PixiJS texture cache for a beatoraja skin's `source[]` bundle.
//
// Beatoraja skins ship PNG / JPG (occasionally BMP) assets — no TGA, unlike LR2 — so a `Blob` + `createImageBitmap`
// path is enough. The cache hands renderers a `Map<sourceId, Texture>` keyed by the same numeric ids `image[].src`
// references, so a sprite update is just `sprite.texture = textures.get(image.src)`.
//
// IMPORTANT — texture lifetime: the cache deliberately does NOT expose a `dispose()` method. Calling
// `texture.destroy(true)` on a beatoraja-skin texture and then rebuilding a new texture from a fresh bitmap can
// hand back a half-disposed `TextureSource` (style=null) from PixiJS v8's internal source cache. WebGPU and WebGL2
// then crash on the next render frame inside `_createBindGroup` / `applyStyleParams`. The host caches the
// `BeatorajaTextureCache` per entry path in the demo (`main.ts`) so the same instance is reused across previews,
// which means we never need to call destroy. The trade-off is that every distinct play-skin variant the user
// previews keeps its bytes resident until page reload — a few tens of MB total in the worst case, which is well
// inside the budget for a debug preview.

import { Texture } from 'pixi.js';
import type { BeatorajaSourceAsset, BeatorajaSourceBundle } from '@be-music/beatoraja-skin';
import { logger } from './logger.ts';

const log = logger('beatoraja-tex');

export interface BeatorajaTextureCache {
  /** Numeric `source[].id` → loaded Pixi Texture. Missing ids returned `undefined`. */
  get(sourceId: number): Texture | undefined;
  /** All loaded textures. Useful for renderer warm-up steps that need to upload everything to the GPU. */
  values(): IterableIterator<Texture>;
  /** Per-id source path (canonical case-corrected key from the file map). */
  pathOf(sourceId: number): string | undefined;
}

/**
 * Build a PixiJS texture cache from an already-resolved {@link BeatorajaSourceBundle}. Each asset's bytes are
 * wrapped in a `Blob`, decoded via `createImageBitmap`, and uploaded to the GPU as a `Texture`. Failures (corrupt
 * image bytes, browser-side decode error) log a warning and leave the slot unset — the renderer falls back to a
 * transparent texture.
 */
export async function loadBeatorajaTexturesFromBundle(
  bundle: BeatorajaSourceBundle,
): Promise<BeatorajaTextureCache> {
  const textures = new Map<number, Texture>();
  const paths = new Map<number, string>();

  await Promise.all(
    bundle.assets.map(async (asset) => {
      try {
        const texture = await decodeAsset(asset);
        textures.set(asset.id, texture);
        paths.set(asset.id, asset.path);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn(`failed to decode source[${asset.id}] '${asset.path}': ${message}`);
      }
    }),
  );

  return {
    get: (sourceId) => textures.get(sourceId),
    values: () => textures.values(),
    pathOf: (sourceId) => paths.get(sourceId),
  };
}

async function decodeAsset(asset: BeatorajaSourceAsset): Promise<Texture> {
  // `bytes` is a `Uint8Array`; the `as Uint8Array<ArrayBuffer>` cast keeps us on the zero-copy path Blob accepts
  // without rewrapping the buffer. Mirrors the LR2 loader's choice. We deliberately do NOT call
  // `URL.revokeObjectURL` for the success path — the blob URL stays alive for the lifetime of the cache, which
  // matches the "no dispose" lifetime contract documented at the top of this file.
  const blob = new Blob([asset.bytes as Uint8Array<ArrayBuffer>]);
  const bitmap = await createImageBitmap(blob);
  const texture = Texture.from(bitmap);
  // Force nearest-neighbor sampling on every loaded texture. Beatoraja skin assets are pixel-art (key beams,
  // judge effects, etc.) and bilinear filtering blurs them on scaling. The setter also forces the renderer to
  // initialize the texture's `style` immediately, which avoids a `addressModeU` null-deref in WebGL2 / WebGPU.
  texture.source.scaleMode = 'nearest';
  texture.label = asset.path;
  texture.source.label = asset.path;
  return texture;
}
