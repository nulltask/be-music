/**
 * Default skin family scene entry-points. Used when neither an LR2 theme nor a beatoraja theme is loaded, OR when a
 * loaded theme doesn't cover the requested scene / chart variant.
 *
 * The scene classes here extend the family-neutral scenes in `scene/core/` directly and render everything through a
 * be-music skin (`phantomSkin` by default, `synesthesiaSkin`, `latticeSkin`, or any `BeMusicSkin`), so this family has no dependency
 * on the LR2 or beatoraja code paths.
 *
 * The family metadata itself (`defaultSkinFamily`) lives in `skin/default/family.ts` alongside the LR2 / beatoraja
 * metadata — see that file for the family contract.
 */
// The Phantom chrome's long-standing standalone entry points (kept for hosts that call them directly).
export {
  renderDefaultGameplayFrame,
  renderFallbackLr2Frame,
  type FallbackGameplayRenderOptions,
  type FallbackGameplayRuntime,
} from '../../skins/phantom/chrome.ts';
export * from './gameplay.ts';
export * from './result.ts';
export * from './select.ts';
export { latticeSkin } from '../../skins/lattice/index.ts';
export { phantomSkin } from '../../skins/phantom/index.ts';
export { plainSkin } from '../../skins/plain/index.ts';
export { synesthesiaSkin } from '../../skins/synesthesia/index.ts';
export { BUILT_IN_BE_MUSIC_SKINS } from '../../skins/built-in.ts';
