import { renderSynesthesiaChrome } from './gameplay-chrome.ts';
import {
  SYNESTHESIA_BOMB_DURATION_MS,
  renderSynesthesiaBombs,
  renderSynesthesiaLanes,
  renderSynesthesiaLongNote,
  renderSynesthesiaNote,
} from './playfield.ts';
import { synesthesiaResultSkin } from './result.ts';
import { synesthesiaSelectSkin } from './select.ts';
import { BE_MUSIC_SKIN_API_VERSION, wideStage, type BeMusicSkin } from '@be-music/skin-sdk';
import { definePixiSkin } from '../pixi-kit/index.ts';

/**
 * Synesthesia — a skin after synaesthetic sound-and-light rhythm games: deep space,
 * streaming 3D stars, a wireframe floor grid, glass panels, colour that keeps time with the music, and hits that
 * detonate as perspective-projected particle bursts.
 */
export const synesthesiaSkin: BeMusicSkin = definePixiSkin({
  apiVersion: BE_MUSIC_SKIN_API_VERSION,
  id: 'synesthesia',
  label: 'Synesthesia',
  version: '1.0.0',
  author: { name: 'be-music', url: 'https://github.com/nulltask/be-music' },
  description:
    'A cosmic particle world in ember and gold with electric blue and magenta accents, where the space flies, flocks, and bursts with the music.',
  homepage: 'https://github.com/nulltask/be-music',
  license: 'MIT',
  fontLoads: ['400 16px "Michroma"', '300 12px "M PLUS 1p"', '500 12px "M PLUS 1p"'],
  stage: wideStage,
  gameplay: {
    renderChrome: renderSynesthesiaChrome,
    renderLanes: renderSynesthesiaLanes,
    renderNote: renderSynesthesiaNote,
    renderLongNote: renderSynesthesiaLongNote,
    renderBombs: renderSynesthesiaBombs,
    bombDurationMs: SYNESTHESIA_BOMB_DURATION_MS,
  },
  select: synesthesiaSelectSkin,
  result: synesthesiaResultSkin,
});
