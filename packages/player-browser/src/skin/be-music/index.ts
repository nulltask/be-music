// The be-music skin registry. The skin contract it validates (`BeMusicSkin` and the helpers over it) is
// `@be-music/player-skin-sdk`'s and isn't re-exported.
export {
  createBeMusicSkinRegistry,
  resolveSelectListWindow,
  type BeMusicSkinRegistry,
  type BeMusicSkinRegistryOptions,
} from './registry.ts';
