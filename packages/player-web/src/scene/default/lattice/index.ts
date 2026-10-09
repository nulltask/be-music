import type { BeMusicSkin } from '../../../skin/be-music/types.ts';
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
import { wideStage } from '../stage.ts';

/**
 * Lattice — a skin in the manner of precise, typographic interaction design (the Japanese web / broadcast interaction-design
 * school): warm paper and graph-paper rules, ink with one cobalt accent, a field of
 * needles that turns like iron filings to the beat and to every key press, odometer counters, letters that drop in on
 * springs, and tile-flip transitions.
 */
export const latticeSkin: BeMusicSkin = {
  id: 'lattice',
  label: 'Lattice',
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
};
