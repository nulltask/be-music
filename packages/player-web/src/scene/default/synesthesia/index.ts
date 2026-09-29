import type { BeMusicSkin } from '../../../skin/be-music/types.ts';
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

/**
 * Synesthesia — a skin after synaesthetic sound-and-light rhythm games: deep space,
 * streaming 3D stars, a wireframe floor grid, glass panels, colour that keeps time with the music, and hits that
 * detonate as perspective-projected particle bursts.
 */
export const synesthesiaSkin: BeMusicSkin = {
  id: 'synesthesia',
  label: 'Synesthesia',
  fontLoads: ['400 16px "Michroma"', '300 12px "M PLUS 1p"', '500 12px "M PLUS 1p"'],
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
};
