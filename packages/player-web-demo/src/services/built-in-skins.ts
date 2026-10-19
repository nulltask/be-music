// The built-in be-music skins the default family draws with, and the fonts the page waits for before the app starts.

import {
  BUILT_IN_BE_MUSIC_SKINS,
  createBeMusicSkinRegistry,
  latticeSkin,
  plainSkin,
  synesthesiaSkin,
  type BeMusicSkinRegistry,
} from '@be-music/player-web/skin';
import type { BeMusicSkin } from '@be-music/skin-sdk';
import { readStoredBuiltInSkinId } from './settings.ts';

/**
 * Built-in be-music skins beyond Synesthesia and Plain are on hold while those two are polished: Phantom and Lattice,
 * and "Add skin" (a be-music skin module). The code stays; turning this on brings them back. LR2 themes and beatoraja
 * skins are not affected: they load from a drop, `?skin=` or the skin ZIP URL as before.
 */
export const EXTRA_BUILT_IN_SKINS_ENABLED: boolean = false;

/** Built-in be-music skins the default family can render with; the Debug Menu's "Built-in skin" picks one. */
export const BE_MUSIC_SKINS: BeMusicSkinRegistry = createBeMusicSkinRegistry(
  EXTRA_BUILT_IN_SKINS_ENABLED ? BUILT_IN_BE_MUSIC_SKINS : [synesthesiaSkin, plainSkin],
);
// Lattice ships with the player but isn't loaded by default; bring it back when it was the last skin picked.
if (EXTRA_BUILT_IN_SKINS_ENABLED && readStoredBuiltInSkinId() === latticeSkin.id) BE_MUSIC_SKINS.add(latticeSkin);

/** Loads an added skin's faces in the background, so its first frame doesn't rasterize with a fallback font. */
export function loadSkinFonts(skin: BeMusicSkin): void {
  if (!('fonts' in document)) return;
  for (const font of skin.fontLoads) void document.fonts.load(font).catch(() => {});
}

const DEFAULT_UI_FONT_LOADS: readonly string[] = [
  '400 22px "LINE Seed JP"',
  '700 18px "LINE Seed JP"',
  '900 32px "Azeret Mono"',
  // Every registered skin's faces (the built-ins plus any added at startup, such as a remembered Lattice), so switching
  // skins never rasterizes a first frame with a fallback font.
  ...new Set(BE_MUSIC_SKINS.skins.flatMap((skin) => skin.fontLoads)),
];

export async function waitForDefaultUiFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  try {
    await Promise.race([
      Promise.all(DEFAULT_UI_FONT_LOADS.map((font) => document.fonts.load(font))),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 1500);
      }),
    ]);
  } catch {
    // The stylesheet uses font-display=swap, so the app can still start with browser fallbacks if Google Fonts is blocked.
  }
}
