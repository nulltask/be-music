/**
 * Pixi kit — what the built-in Pixi skins (Phantom, Synesthesia, Lattice) share on top of the framework-free skin SDK:
 * {@link definePixiSkin}, which runs Pixi renderer functions on the canvas the player hands a skin, plus pooled HUD
 * text, skin text and hit areas, cap-height alignment, GPU point particles, and key-beam gradients. It belongs to the
 * skins, not the SDK: a skin built with another framework (three.js, raw WebGL, Canvas 2D) needs none of it.
 */
export * from './define-pixi-skin.ts';
export * from './types.ts';
export * from './pools.ts';
export * from './hud-text.ts';
export * from './skin-text.ts';
export * from './text-metrics.ts';
export * from './particle-layer.ts';
export * from './key-beam.ts';
export * from './mine.ts';
