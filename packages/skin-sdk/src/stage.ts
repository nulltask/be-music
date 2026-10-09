import type { BeMusicRect, BeMusicStage } from './types.ts';

/**
 * 16:9 design canvas shared by the built-in skins. It keeps the 480 px height of the LR2-compatible 640x480 canvas, so
 * the playfield (lane widths, judgement line, note speed) is pixel-for-pixel the 4:3 one; the extra 214 px of width
 * goes to the BGA and the HUD on the right.
 */
export const STAGE_WIDTH = 854;
export const STAGE_HEIGHT = 480;

/** Horizontal page margin every built-in skin aligns its outer chrome to. */
export const STAGE_MARGIN = 16;

/**
 * The column on the right edge holding the judgement tally, and the vertical band the BGA may use (between the header
 * and the bottom HUD).
 */
export const STAGE_SIDE_COLUMN = { x: 746, w: 92 } as const;
export const STAGE_BGA_BAND = { top: 56, bottom: 340 } as const;
/** Gap kept between the playfield (rails included) and the BGA, and between the BGA and the side column. */
const BGA_GUTTER_LEFT = 32;
const BGA_GUTTER_RIGHT = 20;
/** Below this the BGA would be a postage stamp (48 KEY spans the page); it is hidden instead. */
const MIN_BGA_SIZE = 120;

/**
 * The BGA square for a playfield ending at `playfieldRight`: as large as the band allows (284 px) and centred in the
 * room between the playfield and the side column, shrinking only when a wide playfield (double play) leaves less room.
 * The square stays vertically centred in the band. A playfield too wide for a {@link MIN_BGA_SIZE} square
 * gets an empty rect (no BGA).
 */
export function resolveStageBgaRect(playfieldRight: number): BeMusicRect {
  const left = playfieldRight + BGA_GUTTER_LEFT;
  const right = STAGE_SIDE_COLUMN.x - BGA_GUTTER_RIGHT;
  const band = STAGE_BGA_BAND.bottom - STAGE_BGA_BAND.top;
  const fit = Math.min(band, right - left);
  const size = fit >= MIN_BGA_SIZE ? fit : 0;
  return {
    x: Math.round(left + (right - left - size) / 2),
    y: Math.round(STAGE_BGA_BAND.top + (band - size) / 2),
    w: size,
    h: size,
  };
}

/** The stage every built-in skin declares. */
export const wideStage: BeMusicStage = {
  width: STAGE_WIDTH,
  height: STAGE_HEIGHT,
  resolveBgaRect: resolveStageBgaRect,
};
