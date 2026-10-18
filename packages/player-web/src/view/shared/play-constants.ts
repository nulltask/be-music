import { Color } from 'pixi.js';

// Gameplay fallback palette. Family-specific chrome can override these in its own renderer.
export const BG: Color = new Color('#05070b');
export const PANEL: Color = new Color('#10141d');
export const WHITE: Color = new Color('#edf2f7');
export const BLUE: Color = new Color('#56b6f7');
export const RED: Color = new Color('#ff6b6b');
export const YELLOW: Color = new Color('#ffd166');
export const MUTED: Color = new Color('#98a5b3');

export const BOMB_DIVX = 8;
export const BOMB_DIVY = 4;
export const BOMB_CYCLE_MS = 30;

/**
 * BGA rectangle used by the built-in/default chrome path.
 */
export const BGA = { x: 291, y: 56, w: 256, h: 256 } as const;
/**
 * Groove gauge bar used by the built-in/default chrome path.
 */
export const GROOVE = { x: 44, y: 387, w: 200, h: 14 } as const;

export const SPEC_BGA_CANVAS_SIZE = 256;
