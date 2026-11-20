import {
  BE_MUSIC_SKIN_API_VERSION,
  cabinetStage,
  defineBeMusicSkin,
  tallStage,
  type BeMusicSkin,
} from '@be-music/player-skin-sdk';
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
  author: { name: 'Be-Music', url: 'https://github.com/nulltask/be-music' },
  description: 'A minimal skin drawn with the Canvas 2D API — the skin SDK example.',
  homepage: 'https://github.com/nulltask/be-music',
  license: 'MIT',
  fontLoads: [],
  context: '2d',
  // The 16:9 cabinet stage while the screen is wider than tall, the portrait one otherwise.
  stage: cabinetStage,
  portraitStage: tallStage,
  // Plain's ink with its line grey in faint stripes, and the line grey along the edge the notes come from.
  gameplay: {
    draw: drawGameplay,
    laneCover: { color: 0x111114, stripeColor: 0x3a3a42, stripeAlpha: 0.5, edgeColor: 0x3a3a42 },
  },
  select: { layout: SELECT_LAYOUT, portraitLayout: PORTRAIT_SELECT_LAYOUT, outroMs: SELECT_OUTRO_MS, draw: drawSelect },
  result: { draw: drawResult },
});
