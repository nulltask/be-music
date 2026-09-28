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
export * from './gameplay-render.ts';
export * from './gameplay.ts';
export * from './result.ts';
export * from './select.ts';
export { latticeSkin } from './lattice/index.ts';
export { phantomSkin } from './phantom/index.ts';
export { synesthesiaSkin } from './synesthesia/index.ts';
export { BUILT_IN_BE_MUSIC_SKINS } from './built-in-skins.ts';
