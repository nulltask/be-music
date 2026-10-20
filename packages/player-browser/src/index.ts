/**
 * Top-level `@be-music/player-browser` entry: the union of the designed entries (`./host`, `./skin`, `./collection`,
 * `./audio`, `./recording`), plus `logger` and Pixi's `Rectangle`, which belong to no single entry. Prefer the entry
 * that matches the area being worked on (docs/player-web.md, "Entry points").
 */
export * from './host/index.ts';
export * from './skin/index.ts';
export * from './collection/index.ts';
export * from './runtime/index.ts';
export * from './recording/index.ts';

// Logger lives at the package root because it isn't tied to any single area — every entry emits log lines through it.
export * from './logger.ts';

// Pixi re-export. `Rectangle` is required by `extract.canvas`'s `frame` option which calls `frame.copyTo(...)`
// internally — a plain object literal misses that method and silently falls through to `getLocalBounds`. Hosts that
// don't depend on `pixi.js` directly can route through this package's re-export.
export { Rectangle } from 'pixi.js';
