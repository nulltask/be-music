import { RendererType, type Renderer, type Texture } from 'pixi.js';

/**
 * How a Pixi skin draws through the player's own Pixi renderer instead of a second WebGL context on its canvas. A
 * host that renders with Pixi checks a skin for {@link PIXI_HOST_RENDER}; when the skin accepts the host's renderer,
 * the host hands every surface a {@link PixiHostTarget} under {@link PIXI_HOST_TARGET} and shows that texture, so the
 * frame never leaves the GPU (no per-frame canvas upload). Skins outside the kit keep the plain canvas contract.
 */
export const PIXI_HOST_RENDER = Symbol('be-music.pixi-host-render');

/** Key of the {@link PixiHostTarget} on a surface the host renders itself. */
export const PIXI_HOST_TARGET = Symbol('be-music.pixi-host-target');

/** What a Pixi skin offers under {@link PIXI_HOST_RENDER}. */
export interface PixiHostRender {
  /** Whether the skin can draw its frames with `renderer`. */
  accepts(renderer: Renderer): boolean;
}

/** The host's renderer and the texture a surface draws into, both owned by the host. */
export interface PixiHostTarget {
  renderer: Renderer;
  texture: Texture;
}

/** The host-render hook of a skin, if it has one. */
export function pixiHostRender(skin: object): PixiHostRender | undefined {
  return (skin as { [PIXI_HOST_RENDER]?: PixiHostRender })[PIXI_HOST_RENDER];
}

/** The host target handed with `surface`, if the host renders it. */
export function pixiHostTarget(surface: object): PixiHostTarget | undefined {
  return (surface as { [PIXI_HOST_TARGET]?: PixiHostTarget })[PIXI_HOST_TARGET];
}

/** Whether a skin that needs WebGL (`requiresWebGL`) or not can draw with `renderer`. */
export function acceptsHostRenderer(renderer: Renderer, requiresWebGL: boolean): boolean {
  return !requiresWebGL || renderer.type === RendererType.WEBGL;
}
