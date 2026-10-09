/** Letterbox fit of a fixed design canvas into the screen. */
export interface ScaledViewport {
  x: number;
  y: number;
  scale: number;
}

/**
 * Uniform scale + centring offset that fits a `designWidth x designHeight` canvas inside the screen (letterboxed /
 * pillarboxed). Non-finite or non-positive scales fall back to 1.
 */
export function resolveScaledViewport(
  screenWidth: number,
  screenHeight: number,
  designWidth: number,
  designHeight: number,
): ScaledViewport {
  const scale = Math.min(screenWidth / designWidth, screenHeight / designHeight);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: (screenWidth - designWidth * safeScale) / 2,
    y: (screenHeight - designHeight * safeScale) / 2,
    scale: safeScale,
  };
}

/**
 * Upper bound for text rasterization density. High enough for a 3x-DPR display magnified 2.5x; beyond that the glyph
 * textures cost memory without visible gain.
 */
const MAX_TEXT_RESOLUTION = 8;

/**
 * Resolution design-canvas text should rasterize at so it stays crisp after the viewport scale: Pixi rasterizes `Text`
 * into a texture at `resolution` texels per design pixel, and the scene root then magnifies it by `viewportScale`.
 * Matching `viewportScale x rendererResolution` makes one texel land on one device pixel.
 */
export function resolveDesignTextResolution(viewportScale: number, rendererResolution: number): number {
  const value = viewportScale * rendererResolution;
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(MAX_TEXT_RESOLUTION, Math.max(1, Math.round(value * 100) / 100));
}

let designTextResolution = 1;

/** Called by the shared scenes whenever they (re)fit the design canvas; read by the built-in skins' text helpers. */
export function setDesignTextResolution(value: number): void {
  designTextResolution = value;
}

export function getDesignTextResolution(): number {
  return designTextResolution;
}

let designPixelRatio = 1;

/**
 * Device pixels per design pixel on screen right now (`viewport scale × renderer resolution`, not rounded). Set by the
 * shared scenes next to {@link setDesignTextResolution}; canvas skins size their canvases from it so each canvas pixel
 * lands on exactly one screen pixel.
 */
export function setDesignPixelRatio(value: number): void {
  designPixelRatio = Number.isFinite(value) && value > 0 ? value : 1;
}

export function getDesignPixelRatio(): number {
  return designPixelRatio;
}
