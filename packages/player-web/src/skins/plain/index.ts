import { BE_MUSIC_SKIN_API_VERSION, defineBeMusicSkin, type BeMusicSkin } from '@be-music/skin-sdk';
import { drawGameplay } from './gameplay.ts';
import { drawResult } from './result.ts';
import { SELECT_LAYOUT, SELECT_OUTRO_MS, drawSelect } from './select.ts';

/**
 * Plain — the skin SDK's worked example: every screen is drawn with the Canvas 2D API, no Pixi involved. Start here
 * when writing a skin of your own; `gameplay.ts`, `select.ts`, and `result.ts` each draw one screen.
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
  gameplay: { draw: drawGameplay },
  select: { layout: SELECT_LAYOUT, outroMs: SELECT_OUTRO_MS, draw: drawSelect },
  result: { draw: drawResult },
});
