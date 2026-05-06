// PixiJS texture cache for a beatoraja skin's `source[]` bundle.
//
// IMPORTANT: the cache has no `dispose()` by design. `texture.destroy(true)` followed by a fresh decode of the
// same bytes makes PixiJS v8 hand back a half-disposed `TextureSource` (`style = null`) from its internal source
// pool, then crash inside `_createBindGroup` (WebGPU) / `applyStyleParams` (WebGL2) on the next render. The host
// memoizes the cache per entry path so we never need to destroy; trade-off is up to a few tens of MB resident
// per fully-previewed theme, cleared on page reload.

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
export async function loadBeatorajaTexturesFromBundle(bundle: BeatorajaSourceBundle): Promise<BeatorajaTextureCache> {
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
  // The `Uint8Array<ArrayBuffer>` cast keeps Blob on the zero-copy path; mirrors the LR2 loader.
  const blob = new Blob([asset.bytes as Uint8Array<ArrayBuffer>]);
  const bitmap = await createImageBitmap(blob);
  const texture = Texture.from(bitmap);
  // `scaleMode = 'nearest'` is for pixel-art correctness AND has a side effect we depend on: it eagerly
  // initializes the texture's `style`, dodging a `addressModeU` null-deref the WebGL2 / WebGPU bind-group
  // setup hits if the source's first render pass arrives before any style assignment.
  texture.source.scaleMode = 'nearest';
  texture.label = asset.path;
  texture.source.label = asset.path;
  return texture;
}
