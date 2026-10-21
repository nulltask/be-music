import {
  BE_MUSIC_SKIN_API_VERSION,
  defineBeMusicSkin,
  tallStage,
  wideStage,
  type BeMusicSkin,
  type BeMusicSurface,
} from '@be-music/player-skin-sdk';
import { drawPlayfield } from './playfield.ts';
import { mountSelect } from './select.ts';
import { mountGameplay } from './play.ts';
import { mountDecide, mountResult } from './result.ts';

/** Responsive native screens and HUD; Canvas retains time-sensitive lanes, BGA and judgments. */
export const nativeSkin: BeMusicSkin = defineBeMusicSkin({
  apiVersion: BE_MUSIC_SKIN_API_VERSION,
  version: '1.0.0',
  author: { name: 'be-music' },
  license: 'MIT',
  fontLoads: [],
  context: '2d',
  stage: {
    ...wideStage,
    playfield: {
      standard: { top: 8, judgementY: 464, maxRight: 540 },
      touch: { top: 8, judgementY: 424, maxRight: 540 },
    },
    resolveBGARect: () => ({ x: 570, y: 16, w: 260, h: 260 }),
  },
  portraitStage: {
    ...tallStage,
    playfield: {
      standard: { top: 116, judgementY: 838 },
      touch: { top: 116, judgementY: 754 },
    },
    // Gameplay gets the height; BGA remains available in the right side of the compact header.
    resolveBGARect: () => ({ x: 378, y: 8, w: 96, h: 96 }),
  },
  select: { layout: { listX: 0, listTop: 0, listBottomInset: 0, rowHeight: 40 }, draw: drawDOMRequired },
  result: { draw: drawDOMRequired },
  id: 'native',
  label: 'Native (DOM + Canvas)',
  description: 'Native HTML collection, settings, results and score HUD with a Canvas playfield.',
  gameplay: { draw: drawPlayfield },
  decide: { durationMs: 2000, draw: drawDOMRequired },
  dom: { select: mountSelect, gameplay: mountGameplay, decide: mountDecide, result: mountResult },
});

/** Older hosts can show a readable capability notice instead of an empty screen. */
function drawDOMRequired({ context, width, height }: BeMusicSurface<'2d'>): void {
  context.fillStyle = '#10151f';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#edf2fa';
  context.font = '20px system-ui';
  context.textAlign = 'center';
  context.fillText('Native requires a DOM-capable BeMusicSkin host.', width / 2, height / 2);
}
