import type { Renderer, Texture } from 'pixi.js';

/**
 * How a Pixi skin draws through the player's own Pixi renderer instead of a second WebGL context on its canvas. A
 * host that renders with Pixi checks a skin for {@link PIXI_HOST_RENDER}; on such a skin it hands every surface a
 * {@link PixiHostTarget} under {@link PIXI_HOST_TARGET} and shows that texture, so the frame never leaves the GPU (no
 * per-frame canvas upload). Skins outside the kit keep the plain canvas contract.
 */
export const PIXI_HOST_RENDER = Symbol('be-music.pixi-host-render');

/** Key of the {@link PixiHostTarget} on a surface the host renders itself. */
export const PIXI_HOST_TARGET = Symbol('be-music.pixi-host-target');

/** The host's renderer and the texture a surface draws into, both owned by the host. */
export interface PixiHostTarget {
  renderer: Renderer;
  texture: Texture;
}

/** Whether `skin` can draw through the player's renderer. */
export function rendersOnPixiHost(skin: object): boolean {
  return (skin as { [PIXI_HOST_RENDER]?: boolean })[PIXI_HOST_RENDER] === true;
}

/** The host target handed with `surface`, if the host renders it. */
export function pixiHostTarget(surface: object): PixiHostTarget | undefined {
  return (surface as { [PIXI_HOST_TARGET]?: PixiHostTarget })[PIXI_HOST_TARGET];
}
