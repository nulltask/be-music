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

/**
 * Crops per base texture, keyed by the frame's numbers in turn (x, then y, w, h). Looked up for every sprite of every
 * frame, so no key string is built: numeric `Map` keys compare as the old `${x}|${y}|${w}|${h}` text did (`-0` and `0`
 * alike, `NaN` with itself).
 */
type CropsByFrame = Map<number, Map<number, Map<number, Map<number, Texture>>>>;
const cropCache = new WeakMap<Texture, CropsByFrame>();

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
  let byY = bySource.get(rect.x);
  if (!byY) {
    byY = new Map();
    bySource.set(rect.x, byY);
  }
  let byW = byY.get(rect.y);
  if (!byW) {
    byW = new Map();
    byY.set(rect.y, byW);
  }
  let byH = byW.get(rect.w);
  if (!byH) {
    byH = new Map();
    byW.set(rect.w, byH);
  }
  let cached = byH.get(rect.h);
  if (!cached) {
    cached = new Texture({ source: texture.source, frame: new Rectangle(rect.x, rect.y, rect.w, rect.h) });
    byH.set(rect.h, cached);
  }
  return cached;
}
