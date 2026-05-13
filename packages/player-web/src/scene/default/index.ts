/**
 * Default skin family scene entry-points. Used when neither an LR2 theme nor a beatoraja theme is loaded, OR when a
 * loaded theme doesn't cover the requested scene / chart variant.
 *
 * All exports here are typed wrappers around `scene/lr2/` classes that lock the skin slot to `undefined`. The wrappers
 * exist so the host's family-routing layer can name the default-skin code path explicitly instead of relying on
 * `skin: undefined` literals scattered across constructor sites.
 *
 * The family metadata itself (`defaultSkinFamily`) lives in `skin/default/family.ts` alongside the LR2 / beatoraja
 * metadata — see that file for the family contract.
 */
export * from './gameplay-render.ts';
export * from './gameplay.ts';
export * from './result.ts';
export * from './select.ts';
