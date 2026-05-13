/**
 * Barrel for the `@be-music/player-web/scenes` subpath. Re-exports every scene class + the shared `PixiSceneHost`
 * primitive that owns the renderer. Importers that only need scene rendering should reach for this barrel directly so
 * they don't pull in unrelated skin / chart / collection symbols.
 *
 * Private scene helpers (`perf`, `pixi-utils`, `select-ops`, gameplay sub-modules) stay internal to the package — they
 * compose the scene classes' implementations and aren't part of the public contract.
 */
export * from './host.ts';

// Default family — built-in chrome when neither LR2 nor beatoraja themes are loaded.
export * from './default/index.ts';

// LR2 family — Lunatic Rave 2 skin-driven scenes.
export * from './lr2/decide.ts';
export * from './lr2/gameplay.ts';
export * from './lr2/result.ts';
export * from './lr2/select.ts';

// beatoraja family — beatoraja Lua skin-driven scenes.
export * from './beatoraja/bga.ts';
export * from './beatoraja/decide.ts';
export * from './beatoraja/gameplay.ts';
export * from './beatoraja/markers.ts';
export * from './beatoraja/notes.ts';
export * from './beatoraja/result.ts';
export * from './beatoraja/select.ts';
export * from './beatoraja/skin-view.ts';
