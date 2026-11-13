import { DEFAULT_TEXT_FONT } from '@be-music/player-skin-sdk';
import { ACCENT, DANGER, FONT, PANEL } from '../../skins/plain/theme.ts';
import { SYN_CYAN, SYN_DISPLAY_FONT, SYN_GLASS, SYN_MAGENTA } from '../../skins/synesthesia/style.ts';
import { DEFAULT_BPM_CHANGE_WARNING_STYLE, type BPMChangeWarningStyle } from '../shared/bpm-change-warning.ts';

/**
 * The BPM-change warning in each built-in skin's own tone: its type, its blue and red (the ones its FAST and SLOW
 * take) and a frame like its panels'. The player draws the box over the skin, so the look is chosen here by skin id.
 */
const STYLES: Readonly<Record<string, BPMChangeWarningStyle>> = {
  // Plain: the system sans-serif at its label weight, on its panel colour, with a square hairline frame.
  plain: {
    fontFamily: FONT,
    fontWeight: '800',
    letterSpacing: 0,
    rising: Number.parseInt(ACCENT.slice(1), 16),
    falling: Number.parseInt(DANGER.slice(1), 16),
    background: Number.parseInt(PANEL.slice(1), 16),
    backgroundAlpha: 0.9,
    borderWidth: 0.08,
    radius: 0.12,
  },
  // Native: the page's sans-serif on a soft dark chip with rounded corners, as its HUD panels.
  native: {
    fontFamily: DEFAULT_TEXT_FONT,
    fontWeight: '700',
    letterSpacing: 0,
    rising: 0x8ab8ff,
    falling: 0xff8a8a,
    background: 0x101014,
    backgroundAlpha: 0.8,
    borderWidth: 0.07,
    radius: 0.4,
  },
  // Synesthesia: wide technical numerals, electric blue and magenta, a sharp hairline frame on its dark glass.
  synesthesia: {
    fontFamily: SYN_DISPLAY_FONT,
    fontWeight: '700',
    letterSpacing: 0.08,
    rising: SYN_CYAN,
    falling: SYN_MAGENTA,
    background: SYN_GLASS,
    backgroundAlpha: 0.75,
    borderWidth: 0.06,
    radius: 0,
  },
};

/** The warning's look on the built-in skin `skinId`; the default box on a skin without one of its own. */
export function resolveBuiltInBPMChangeWarningStyle(skinId: string): BPMChangeWarningStyle {
  return Object.hasOwn(STYLES, skinId) ? STYLES[skinId]! : DEFAULT_BPM_CHANGE_WARNING_STYLE;
}
