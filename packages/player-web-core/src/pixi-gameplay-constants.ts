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

export const INTRO_DELAY_MS = 3000;

export const LR2_1P_KEYON_TIMER_BASE = 100;
export const LR2_2P_KEYON_TIMER_BASE = 110;
export const LR2_1P_BOMB_TIMER_BASE = 50;
export const LR2_2P_BOMB_TIMER_BASE = 60;

export const PLAYFIELD = { x: 84, y: 72, w: 204, judgementY: 322 } as const;
export const BGA = { x: 291, y: 49, w: 174, h: 274 } as const;
export const GROOVE = { x: 500, y: 72, w: 116, h: 250 } as const;

export const SPEC_BGA_CANVAS_SIZE = 256;
