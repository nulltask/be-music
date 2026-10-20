import { BE_MUSIC_SKIN_API_VERSION, defineBeMusicSkin, tallStage, type BeMusicSkin } from '@be-music/player-skin-sdk';
import { drawGameplay } from './gameplay.ts';
import { PORTRAIT_SELECT_LAYOUT } from './layout.ts';
import { drawResult } from './result.ts';
import { SELECT_LAYOUT, SELECT_OUTRO_MS, drawSelect } from './select.ts';

/**
 * Plain — the skin SDK's worked example: every screen is drawn with the Canvas 2D API, no Pixi involved. Start here
 * when writing a skin of your own; `gameplay.ts`, `select.ts`, and `result.ts` each draw one screen.
 *
 * Plain also supports portrait screens (a phone or tablet held upright): it declares the 9:16 `tallStage` as its
 * `portraitStage` and a `portraitLayout` for the song list, and each screen checks the surface's orientation and draws
 * its portrait arrangement, placed by the functions in `layout.ts`.
 */
export const plainSkin: BeMusicSkin = defineBeMusicSkin({
  apiVersion: BE_MUSIC_SKIN_API_VERSION,
  id: 'plain',
  label: 'Plain',
  version: '1.0.0',
  author: { name: 'be-music', url: 'https://github.com/nulltask/be-music' },
  description: 'A minimal skin drawn with the Canvas 2D API — the skin SDK example.',
  homepage: 'https://github.com/nulltask/be-music',
  license: 'MIT',
  fontLoads: ['500 12px "M PLUS 1p"', '700 12px "M PLUS 1p"', '800 12px "M PLUS 1p"'],
  context: '2d',
  // Drawn on the 16:9 `wideStage` (the default `stage`) while the screen is wider than tall, on this one otherwise.
  portraitStage: tallStage,
  gameplay: { draw: drawGameplay },
  select: { layout: SELECT_LAYOUT, portraitLayout: PORTRAIT_SELECT_LAYOUT, outroMs: SELECT_OUTRO_MS, draw: drawSelect },
  result: { draw: drawResult },
});
