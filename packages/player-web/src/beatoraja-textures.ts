// PixiJS texture cache for a beatoraja skin's `source[]` bundle.
//
// Beatoraja skins ship PNG / JPG (occasionally BMP) assets — no TGA, unlike LR2 — so a `Blob` + `createImageBitmap`
// path is enough. The cache hands renderers a `Map<sourceId, Texture>` keyed by the same numeric ids `image[].src`
// references, so a sprite update is just `sprite.texture = textures.get(image.src)`.
//
// Blob URLs are tracked alongside the texture so `dispose()` can revoke them in lockstep with the GPU teardown.

import { Texture } from 'pixi.js';
import type { BeatorajaSourceAsset, BeatorajaSourceBundle } from '@be-music/beatoraja-skin';
import { logger } from './logger.ts';

const log = logger('beatoraja-tex');

const TEXTURE_BLOB_URL = Symbol.for('be-music-player-web/beatoraja-texture-blob-url');
interface TextureWithBlobUrl extends Texture {
  [TEXTURE_BLOB_URL]?: string;
}

export interface BeatorajaTextureCache {
  /** Numeric `source[].id` → loaded Pixi Texture. Missing ids returned `undefined`. */
  get(sourceId: number): Texture | undefined;
  /** All loaded textures. Useful for renderer warm-up steps that need to upload everything to the GPU. */
  values(): IterableIterator<Texture>;
  /** Per-id source path (canonical case-corrected key from the file map). */
  pathOf(sourceId: number): string | undefined;
  /** Tear down every texture and revoke its blob URL. Idempotent. */
  dispose(): void;
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
    dispose: () => {
      for (const tex of textures.values()) {
        const url = (tex as TextureWithBlobUrl)[TEXTURE_BLOB_URL];
        if (typeof url === 'string') {
          URL.revokeObjectURL(url);
          delete (tex as TextureWithBlobUrl)[TEXTURE_BLOB_URL];
        }
        tex.destroy(true);
      }
      textures.clear();
      paths.clear();
    },
  };
}

async function decodeAsset(asset: BeatorajaSourceAsset): Promise<Texture> {
  // `bytes` is a `Uint8Array`; the `as Uint8Array<ArrayBuffer>` cast keeps us on the zero-copy path Blob accepts
  // without rewrapping the buffer (which would otherwise force a redundant copy). Mirrors the LR2 loader's choice.
  const blob = new Blob([asset.bytes as Uint8Array<ArrayBuffer>]);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const bitmap = await createImageBitmap(blob);
    const texture = Texture.from(bitmap);
    (texture as TextureWithBlobUrl)[TEXTURE_BLOB_URL] = objectUrl;
    return texture;
  } catch (e) {
    URL.revokeObjectURL(objectUrl);
    throw e;
  }
}
