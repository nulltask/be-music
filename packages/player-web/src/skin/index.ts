/**
 * Barrel for the `@be-music/player-web/skin` subpath. Re-exports skin parsing / loading / render helpers and the
 * cross-family `SkinFamily` registry. Pixi-bound texture / font / rendering helpers under `skin/lr2/*` are mostly
 * package-internal (they back the scene classes); the only one re-exported here is `loadTextureFromBytes`, which the
 * demo needs to decode per-song STAGEFILE / BACKBMP / BANNER bitmaps without reaching into private modules.
 */
export * from './family.ts';
export * from './registry.ts';

// LR2 family registration entry + the targeted public texture helper.
export * from './lr2/family.ts';
export { loadTextureFromBytes } from './lr2/textures.ts';

// beatoraja family — theme loaders, audio / fonts / textures.
export * from './beatoraja/audio.ts';
export * from './beatoraja/chart-images.ts';
export * from './beatoraja/family.ts';
export * from './beatoraja/fonts.ts';
export * from './beatoraja/render.ts';
// The scene kit loader; `BeatorajaSceneKit` itself is a family kit type, exported from `./scenes`.
export {
  createBeatorajaSceneKitCaches,
  createBeatorajaSkinLoadContext,
  defaultBeatorajaSkinConfig,
  loadBeatorajaSceneKit,
  releaseBeatorajaSceneKitAssets,
  resolveBeatorajaSkinConfig,
  type BeatorajaSceneKitCaches,
  type BeatorajaSkinLoadContextOptions,
  type LoadBeatorajaSceneKitOptions,
  type LoadBeatorajaSceneKitResult,
  type LoadedBeatorajaSceneKit,
} from './beatoraja/scene-kit.ts';
export * from './beatoraja/textures.ts';
export * from './beatoraja/theme.ts';

// Default family registration entry + the be-music skin format its built-in skins implement.
export * from './default/family.ts';
export * from './be-music/index.ts';
