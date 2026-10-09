import { renderPhantomChrome } from './chrome.ts';
import {
  PHANTOM_BOMB_DURATION_MS,
  renderPhantomBombs,
  renderPhantomLanes,
  renderPhantomLongNote,
  renderPhantomNote,
} from './playfield.ts';
import { phantomResultSkin } from './result.ts';
import { phantomSelectSkin } from './select.ts';
import { type BeMusicSkin, wideStage, BE_MUSIC_SKIN_API_VERSION, defineBeMusicSkin } from '../../skin-sdk/index.ts';

/**
 * Phantom — the built-in poster skin: ink black, blood red, and paper white, with slanted plates, starbursts,
 * halftone fields, and condensed italic type. The playfield itself stays plain and IIDX-like.
 */
export const phantomSkin: BeMusicSkin = defineBeMusicSkin({
  apiVersion: BE_MUSIC_SKIN_API_VERSION,
  id: 'phantom',
  label: 'Phantom',
  version: '1.0.0',
  author: { name: 'be-music', url: 'https://github.com/nulltask/be-music' },
  description:
    'Poster-style skin in ink black, blood red, and paper white: slanted plates, starbursts, halftone fields, and ransom-note showpieces.',
  homepage: 'https://github.com/nulltask/be-music',
  license: 'MIT',
  fontLoads: ['400 24px "Anton"', '400 18px "Dela Gothic One"', '700 12px "M PLUS 1p"', '800 12px "M PLUS 1p"'],
  stage: wideStage,
  gameplay: {
    renderChrome: renderPhantomChrome,
    renderLanes: renderPhantomLanes,
    renderNote: renderPhantomNote,
    renderLongNote: renderPhantomLongNote,
    renderBombs: renderPhantomBombs,
    bombDurationMs: PHANTOM_BOMB_DURATION_MS,
  },
  select: phantomSelectSkin,
  result: phantomResultSkin,
});
