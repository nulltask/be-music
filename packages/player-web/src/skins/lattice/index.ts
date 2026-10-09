import { renderLatticeChrome } from './gameplay-chrome.ts';
import {
  LATTICE_BOMB_DURATION_MS,
  renderLatticeBombs,
  renderLatticeLanes,
  renderLatticeLongNote,
  renderLatticeNote,
} from './playfield.ts';
import { latticeResultSkin } from './result.ts';
import { latticeSelectSkin } from './select.ts';
import { BE_MUSIC_SKIN_API_VERSION, wideStage, type BeMusicSkin } from '@be-music/skin-sdk';
import { definePixiSkin } from '../pixi-kit/index.ts';

/**
 * Lattice — a skin in the manner of precise, typographic interaction design (the Japanese web / broadcast interaction-design
 * school): warm paper and graph-paper rules, ink with one cobalt accent, a field of
 * needles that turns like iron filings to the beat and to every key press, odometer counters, letters that drop in on
 * springs, and tile-flip transitions.
 */
export const latticeSkin: BeMusicSkin = definePixiSkin({
  apiVersion: BE_MUSIC_SKIN_API_VERSION,
  id: 'lattice',
  label: 'Lattice',
  version: '1.0.0',
  author: { name: 'be-music', url: 'https://github.com/nulltask/be-music' },
  description:
    'Precise, typographic paper skin: graph-paper rules, ink with one cobalt accent, and a needle field that turns with the beat.',
  homepage: 'https://github.com/nulltask/be-music',
  license: 'MIT',
  fontLoads: [
    '200 32px "Inter"',
    '300 16px "Inter"',
    '400 12px "Inter"',
    '600 12px "Inter"',
    '500 10px "Azeret Mono"',
    '300 12px "M PLUS 1p"',
    '500 12px "M PLUS 1p"',
  ],
  stage: wideStage,
  gameplay: {
    renderChrome: renderLatticeChrome,
    renderLanes: renderLatticeLanes,
    renderNote: renderLatticeNote,
    renderLongNote: renderLatticeLongNote,
    renderBombs: renderLatticeBombs,
    bombDurationMs: LATTICE_BOMB_DURATION_MS,
  },
  select: latticeSelectSkin,
  result: latticeResultSkin,
});
