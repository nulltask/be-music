import { latticeSkin } from './lattice/index.ts';
import { phantomSkin } from './phantom/index.ts';
import { synesthesiaSkin } from './synesthesia/index.ts';
import type { BeMusicSkin } from '../skin-sdk/index.ts';

/** Every be-music skin that ships with the player, in picker order. The first is the default. */
export const BUILT_IN_BE_MUSIC_SKINS: readonly BeMusicSkin[] = [phantomSkin, synesthesiaSkin, latticeSkin];
