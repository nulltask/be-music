/**
 * What a host hands a scene to draw it with, per skin family: the **family kit**. The host API is the same for every
 * family (`createSelectScene(kit, …)` and its siblings); only the kit says which family draws the scene and with what
 * (ADR 0001). A kit is loaded before the scene is made: the family view reads it, the scene session never does.
 *
 * - `built-in`: a be-music skin (`@be-music/skin-sdk`) with the player's settings for it.
 * - `lr2`: the LR2 skin for the screen.
 * - `beatoraja`: one entry of a beatoraja theme, loaded (skin, textures, fonts, the player's options, the theme files).
 */

import type { LR2Skin } from '@be-music/lr2-skin';
import type { BeMusicEffectLevel, BeMusicSkin } from '@be-music/skin-sdk';
import type { BeatorajaSceneKit } from '../skin/beatoraja/scene-kit.ts';

// The beatoraja kit's loaded entry is the skin layer's (`loadBeatorajaSceneKit` loads it).
export type { BeatorajaSceneKit };

/** The screens of a play: select, decide, play and result. */
export type SceneKind = 'select' | 'decide' | 'play' | 'result';

/** The skin families: the built-in be-music skins, LR2 skins and beatoraja skins. */
export type SceneFamily = 'built-in' | 'lr2' | 'beatoraja';

/** Which screen a scene is and which family draws it; the host's router and test hook read it. */
export interface SceneIdentity {
  readonly kind: SceneKind;
  readonly family: SceneFamily;
}

/** A be-music skin, with the player's settings for it. */
export interface BuiltInKit {
  readonly family: 'built-in';
  readonly skin: BeMusicSkin;
  /**
   * The player's values for the skin's `settings`, by setting id. The view checks them against the skin's schema
   * (`resolveBeMusicSkinSettings`) before drawing; the skin's defaults apply without them.
   */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** How much motion the skin shows (entrance, outro, ambient); `'full'` without one. */
  readonly effects?: BeMusicEffectLevel;
}

/** The LR2 skin for one screen. */
export interface LR2Kit {
  readonly family: 'lr2';
  readonly skin: LR2Skin;
}

/** The LR2 play skin, with the skin that draws invisible notes. */
export interface LR2PlayKit extends LR2Kit {
  /**
   * The 9-keys play skin whose `notes.note[3]` (the green wide note of LR2's POP layout) is drawn over each invisible
   * note when they are shown; a flat green bar without it.
   */
  readonly invisibleNoteSkin?: LR2Skin;
}

/** A beatoraja theme entry, loaded. */
export interface BeatorajaKit {
  readonly family: 'beatoraja';
  readonly kit: BeatorajaSceneKit;
}

/** What the select screen is drawn with. */
export type SelectKit = BuiltInKit | LR2Kit | BeatorajaKit;

/** What the decide screen is drawn with. */
export type DecideKit = BuiltInKit | LR2Kit | BeatorajaKit;

/** What the play screen is drawn with. */
export type PlayKit = BuiltInKit | LR2PlayKit | BeatorajaKit;

/** What the result screen is drawn with. */
export type ResultKit = BuiltInKit | LR2Kit | BeatorajaKit;

/** Any scene's kit. */
export type FamilyKit = SelectKit | DecideKit | PlayKit | ResultKit;
