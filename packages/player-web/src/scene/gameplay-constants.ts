import { Color } from 'pixi.js';

// Gameplay fallback palette. Family-specific chrome can override these in its own renderer.
export const BG = new Color('#05070b');
export const PANEL = new Color('#10141d');
export const WHITE = new Color('#edf2f7');
export const BLUE = new Color('#56b6f7');
export const RED = new Color('#ff6b6b');
export const YELLOW = new Color('#ffd166');
export const MUTED = new Color('#98a5b3');

export const PIXELS_PER_BEAT = 72;
/**
 * Design canvas the gameplay path renders into. 640x480 matches the LR2 default skin's authored canvas (LR2 default
 * `play_*.lr2skin` doesn't carry a `#RESOLUTION` directive, so the loader's seed at `skin.ts` width=640 /
 * height=480 wins). Keeping the design space aligned with the skin's native width/height lets `renderLanes`' `skinX +
 * lr2Lane.x * scale` resolve to scale=1.0 with no horizontal offset.
 */
export const DESIGN_WIDTH = 640;
export const DESIGN_HEIGHT = 480;

export const BOMB_DIVX = 8;
export const BOMB_DIVY = 4;
export const BOMB_CYCLE_MS = 30;

export const HISPEED_MIN = 0.1;
export const HISPEED_MAX = 6.0;
export const HISPEED_STEP = 0.1;

/**
 * Fallback time-to-chart-start (in ms) used when the active skin doesn't author a `#PLAYSTART` directive. The skin's
 * timing wins when it specifies one.
 */
export const FALLBACK_INTRO_DELAY_MS = 3000;

export const LR2_1P_KEYON_TIMER_BASE = 100;
export const LR2_2P_KEYON_TIMER_BASE = 110;
export const LR2_1P_BOMB_TIMER_BASE = 50;
export const LR2_2P_BOMB_TIMER_BASE = 60;
/**
 * LR2 long-note hold-effect timers: 70-79 for the 1P side, 80-89 for the 2P side.
 */
export const LR2_1P_LN_HOLD_TIMER_BASE = 70;
export const LR2_2P_LN_HOLD_TIMER_BASE = 80;

/**
 * Playfield rectangle for the no-skin lane geometry. Coordinates come from LR2's default 7K skin so LR2 skins and the
 * built-in default family share the same note-position contract while their chrome stays separate.
 */
export const PLAYFIELD = { x: 33, y: 0, w: 194, judgementY: 321 } as const;
/**
 * BGA rectangle used by the built-in/default chrome path.
 */
export const BGA = { x: 291, y: 56, w: 256, h: 256 } as const;
/**
 * Groove gauge bar used by the built-in/default chrome path.
 */
export const GROOVE = { x: 44, y: 387, w: 200, h: 14 } as const;

export const SPEC_BGA_CANVAS_SIZE = 256;
