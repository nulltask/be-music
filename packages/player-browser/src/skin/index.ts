/**
 * Barrel for the `@be-music/player-browser/skin` entry: the skin families and their loading. The cross-family
 * `SkinFamily` registry, the LR2 and beatoraja theme loaders (with their audio, fonts, textures and the beatoraja scene
 * kit), the default family with the be-music skin registry, and the built-in be-music skins. Pixi-bound texture / font /
 * rendering helpers under `skin/lr2/*` are mostly package-internal (they back the family views); the only one exported
 * here is `loadTextureFromBytes`, which the demo needs to decode per-song STAGEFILE / BACKBMP / BANNER bitmaps.
 *
 * The be-music skin contract itself (`BeMusicSkin`, its frames and settings) is `@be-music/player-skin-sdk`'s, and isn't
 * re-exported here.
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
// The scene kit loader; `BeatorajaSceneKit` itself is a family kit type, exported from `./host`.
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

// Default family registration entry + the registry of the be-music skins it draws with.
export * from './default/family.ts';
export * from './be-music/index.ts';

// The built-in be-music skins, drawn when neither an LR2 nor a beatoraja theme is loaded, or when a loaded theme doesn't
// cover the scene or the chart's variant. `BUILT_IN_BE_MUSIC_SKINS` is the default set, in picker order.
export { BUILT_IN_BE_MUSIC_SKINS } from '../skins/built-in.ts';
export { plainSkin } from '../skins/plain/index.ts';
export { synesthesiaSkin } from '../skins/synesthesia/index.ts';

export { nativeSkin } from '../skins/native/index.ts';
