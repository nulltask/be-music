import { phantomSkin } from './phantom/index.ts';
import { plainSkin } from './plain/index.ts';
import { synesthesiaSkin } from './synesthesia/index.ts';
import type { BeMusicSkin } from '../skin-sdk/index.ts';

/**
 * The be-music skins a player loads by default, in picker order; the first is the default. More skins — the bundled
 * `latticeSkin`, or third-party ones — are added to a registry with `BeMusicSkinRegistry.add`.
 */
export const BUILT_IN_BE_MUSIC_SKINS: readonly BeMusicSkin[] = [synesthesiaSkin, phantomSkin, plainSkin];
