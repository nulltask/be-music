// The built-in be-music skins the default family draws with, and the fonts the page waits for before the app starts.

import {
  BUILT_IN_BE_MUSIC_SKINS,
  createBeMusicSkinRegistry,
  type BeMusicSkinRegistry,
} from '@be-music/player-browser/skin';
import type { BeMusicSkin } from '@be-music/player-skin-sdk';

/**
 * "Add skin" (a be-music skin module from a URL) is on hold: the code stays, and turning this on brings it back. LR2 themes
 * and beatoraja skins are not affected: they load from a drop, `?skin=` or the skin ZIP URL as before.
 */
export const ADD_SKIN_ENABLED: boolean = false;

/** Built-in be-music skins the default family can render with; the Debug Menu's "Built-in skin" picks one. */
export const BE_MUSIC_SKINS: BeMusicSkinRegistry = createBeMusicSkinRegistry(BUILT_IN_BE_MUSIC_SKINS);

/** Loads an added skin's faces in the background, so its first frame doesn't rasterize with a fallback font. */
export function loadSkinFonts(skin: BeMusicSkin): void {
  if (!('fonts' in document)) return;
  for (const font of skin.fontLoads) void document.fonts.load(font).catch(() => {});
}

const DEFAULT_UI_FONT_LOADS: readonly string[] = [
  '400 22px "LINE Seed JP"',
  '700 18px "LINE Seed JP"',
  '900 32px "Azeret Mono"',
  // Every registered skin's faces, so switching skins never rasterizes a first frame with a fallback font.
  ...new Set(BE_MUSIC_SKINS.skins.flatMap((skin) => skin.fontLoads)),
];

export async function waitForDefaultUIFonts(): Promise<void> {
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
