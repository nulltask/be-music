// Helpers shared by the skin view and its element renderers.

import { Rectangle, Texture } from 'pixi.js';

export const BEATORAJA_VIEW_DIAGNOSTICS = false;

/**
 * Apply the destination's `filter` field to the underlying texture source. `1` requests bilinear
 * filtering (smooth scaling); anything else is a no-op (sources default to `'nearest'` at decode
 * time, set by `decodeAsset` in `beatoraja-textures.ts`). Filter is set on the source rather
 * than the sprite — Pixi v8 exposes scale mode at the source level — so every sprite sharing
 * the source picks up the change. In practice skin authors apply `filter=1` to atlases where
 * every cell wants the same treatment, so the source-level scope is the right granularity.
 */
export function applyTextureFilterMode(texture: Texture | undefined, filter: number): void {
  if (filter !== 1) return;
  if (texture === undefined || texture === Texture.EMPTY) return;
  if (texture.source) texture.source.scaleMode = 'linear';
}

export function updateDynamicCropTexture(
  current: Texture | undefined,
  baseTexture: Texture | undefined,
  rect: { x: number; y: number; w: number; h: number },
): Texture | undefined {
  if (
    baseTexture === undefined ||
    baseTexture === Texture.EMPTY ||
    rect.w <= 0 ||
    rect.h <= 0 ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.w) ||
    !Number.isFinite(rect.h)
  ) {
    return destroyTextureView(current);
  }
  const frame = new Rectangle(rect.x, rect.y, rect.w, rect.h);
  if (current !== undefined && !current.destroyed && current.source === baseTexture.source) {
    current.frame.copyFrom(frame);
    current.update();
    return current;
  }
  destroyTextureView(current);
  return new Texture({ source: baseTexture.source, frame, dynamic: true });
}

export function destroyTextureView(texture: Texture | undefined): undefined {
  if (texture !== undefined && !texture.destroyed) {
    texture.destroy(false);
  }
  return undefined;
}
