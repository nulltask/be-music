/**
 * Top-level `@be-music/player-web` entry. Re-exports every public symbol from the per-area subpath barrels for
 * backwards compatibility — consumers can keep importing from `@be-music/player-web` directly.
 *
 * For new code, **prefer the per-area subpaths** (`@be-music/player-web/scenes`, `/skin`, `/chart`, `/collection`,
 * `/runtime`). They document the dependency surface explicitly and keep the imports cohesive with the area being
 * worked on.
 */
export * from './scene/index.ts';
export * from './skin/index.ts';
export * from './chart/index.ts';
export * from './collection/index.ts';
export * from './runtime/index.ts';

// Logger lives at the package root because it isn't tied to any single area — every subpath emits log lines through it.
export * from './logger.ts';

// Pixi re-export. `Rectangle` is required by `extract.canvas`'s `frame` option which calls `frame.copyTo(...)`
// internally — a plain object literal misses that method and silently falls through to `getLocalBounds`. Hosts that
// don't depend on `pixi.js` directly can route through this package's re-export.
export { Rectangle } from 'pixi.js';
