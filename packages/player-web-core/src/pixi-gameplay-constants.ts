import { Color } from 'pixi.js';

// Fallback palette (skin-less demo only). Once a skin supplies its own
// atlas every visible pixel comes from the skin.
export const BG = new Color('#05070b');
export const PANEL = new Color('#10141d');
export const WHITE = new Color('#edf2f7');
export const BLUE = new Color('#56b6f7');
export const RED = new Color('#ff6b6b');
export const YELLOW = new Color('#ffd166');
export const MUTED = new Color('#98a5b3');

export const PIXELS_PER_BEAT = 72;
export const DESIGN_WIDTH = 640;
export const DESIGN_HEIGHT = 480;

export const BOMB_DIVX = 8;
export const BOMB_DIVY = 4;
export const BOMB_CYCLE_MS = 30;

export const HISPEED_MIN = 0.1;
export const HISPEED_MAX = 6.0;
export const HISPEED_STEP = 0.1;

/**
 * Fallback time-to-chart-start (in ms) used when the active LR2
 * skin doesn't author a `#PLAYSTART` directive. The skin's
 * timing wins when it specifies one — see `Lr2SkinTiming.playStart`.
 * 3 s leaves enough breathing room for the slide-in chrome of
 * skinless / non-LR2 demos before notes begin.
 */
export const FALLBACK_INTRO_DELAY_MS = 3000;

export const LR2_1P_KEYON_TIMER_BASE = 100;
export const LR2_2P_KEYON_TIMER_BASE = 110;
export const LR2_1P_BOMB_TIMER_BASE = 50;
export const LR2_2P_BOMB_TIMER_BASE = 60;
/**
 * LR2 long-note hold-effect timers — fire at LN press, stop at LN
 * release. Per-lane: `70 = 1P SC, 71..77 = 1P key1..7, 78 / 79 =
 * 1P key8 / 9; 80 / 81..87 / 88..89` for the 2P side. Used by
 * skins to drive LN-specific overlays (sustain glow, sparkles)
 * that are independent of the regular key-on lasers.
 */
export const LR2_1P_LN_HOLD_TIMER_BASE = 70;
export const LR2_2P_LN_HOLD_TIMER_BASE = 80;

export const PLAYFIELD = { x: 84, y: 72, w: 204, judgementY: 322 } as const;
export const BGA = { x: 291, y: 49, w: 174, h: 274 } as const;
export const GROOVE = { x: 500, y: 72, w: 116, h: 250 } as const;

export const SPEC_BGA_CANVAS_SIZE = 256;
