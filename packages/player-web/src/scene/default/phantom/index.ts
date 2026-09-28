import type { BeMusicSkin } from '../../../skin/be-music/types.ts';
import { renderDefaultGameplayFrame } from '../gameplay-render.ts';
import {
  PHANTOM_BOMB_DURATION_MS,
  renderPhantomBombs,
  renderPhantomLanes,
  renderPhantomLongNote,
  renderPhantomNote,
} from './playfield.ts';
import { phantomResultSkin } from './result.ts';
import { phantomSelectSkin } from './select.ts';

/**
 * Phantom — the built-in poster skin: ink black, blood red, and paper white, with slanted plates, starbursts,
 * halftone fields, and condensed italic type. The playfield itself stays plain and IIDX-like.
 */
export const phantomSkin: BeMusicSkin = {
  id: 'phantom',
  label: 'Phantom',
  fontLoads: ['400 24px "Anton"', '400 18px "Dela Gothic One"', '700 12px "M PLUS 1p"', '800 12px "M PLUS 1p"'],
  gameplay: {
    renderChrome: ({ layer, overlayLayer, layerPool, overlayLayerPool, runtime }) =>
      renderDefaultGameplayFrame(layer, runtime, { overlayLayer, layerPool, overlayLayerPool }),
    renderLanes: renderPhantomLanes,
    renderNote: renderPhantomNote,
    renderLongNote: renderPhantomLongNote,
    renderBombs: renderPhantomBombs,
    bombDurationMs: PHANTOM_BOMB_DURATION_MS,
  },
  select: phantomSelectSkin,
  result: phantomResultSkin,
};
