import { Rectangle, Texture } from 'pixi.js';

export interface PixiCropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CreateCachedCroppedTextureOptions {
  /**
   * Reject NaN / Infinity frame values before constructing a Pixi texture. Beatoraja skins can
   * derive frame sizes from runtime state, and PixiJS v8 can crash later in WebGPU binding when
   * a degenerate frame slips through.
   */
  requireFiniteFrame?: boolean;
}

const cropCache = new WeakMap<Texture, Map<string, Texture>>();

/**
 * Returns a cached `Texture` view that crops `texture` to `rect` while reusing the same
 * `TextureSource`. The cache is keyed by the base texture and exact numeric frame values, so
 * fractional animation cells keep distinct entries without extra GPU uploads.
 */
export function createCachedCroppedTexture(
  texture: Texture | undefined,
  rect: PixiCropRect,
  options: CreateCachedCroppedTextureOptions = {},
): Texture | undefined {
  if (!texture || rect.w <= 0 || rect.h <= 0) {
    return undefined;
  }
  if (
    options.requireFiniteFrame &&
    (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.w) || !Number.isFinite(rect.h))
  ) {
    return undefined;
  }

  let bySource = cropCache.get(texture);
  if (!bySource) {
    bySource = new Map();
    cropCache.set(texture, bySource);
  }

  const key = `${rect.x}|${rect.y}|${rect.w}|${rect.h}`;
  let cached = bySource.get(key);
  if (!cached) {
    cached = new Texture({ source: texture.source, frame: new Rectangle(rect.x, rect.y, rect.w, rect.h) });
    bySource.set(key, cached);
  }
  return cached;
}
