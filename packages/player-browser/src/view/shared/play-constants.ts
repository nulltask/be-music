import { Color } from 'pixi.js';

// Gameplay fallback palette. Family-specific chrome can override these in its own renderer.
export const BG: Color = new Color('#05070b');
export const BLUE: Color = new Color('#56b6f7');

/**
 * BGA rectangle used by the built-in/default chrome path.
 */
export const BGA = { x: 291, y: 56, w: 256, h: 256 } as const;
