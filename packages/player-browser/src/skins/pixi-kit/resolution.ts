/** Most texels per design pixel text rasterizes at, whatever the display. */
const MAX_TEXT_RESOLUTION = 8;

let current = 1;

/**
 * Sets the density Pixi-kit text rasterizes at: the surface's canvas pixels per design pixel, so one glyph texel lands
 * on one screen pixel. The Pixi skin adapter calls it before each frame.
 */
export function setTextResolution(pixelRatio: number): void {
  current = Number.isFinite(pixelRatio) && pixelRatio > 0 ? Math.min(MAX_TEXT_RESOLUTION, pixelRatio) : 1;
}

/** Density text should rasterize at this frame (see {@link setTextResolution}). */
export function textResolution(): number {
  return current;
}
