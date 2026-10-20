import {
  STAGE_BGA_BAND,
  STAGE_SIDE_COLUMN,
  type BeMusicGameplayLayout,
  type BeMusicRect,
} from '@be-music/player-skin-sdk';

/** Synesthesia's own HUD geometry on the 16:9 stage, and on the 9:16 portrait stage. */

/** The groove gauge's bar (its frame and labels are drawn around it). */
export const GROOVE = { x: 44, y: 387, w: 200, h: 14 } as const;

/** Side margin of the portrait HUD, and the gutter between its BGA monitor and HUD column. */
export const PORTRAIT_MARGIN = 12;

/**
 * The groove gauge's bar for `layout`: {@link GROOVE} on the landscape stage; on a portrait stage a full-width strip in
 * the band between the BGA monitor and the lanes, its label line above it.
 */
export function resolveGrooveRect(
  layout: Pick<BeMusicGameplayLayout, 'orientation' | 'stage' | 'playfield'>,
): BeMusicRect {
  if (layout.orientation !== 'portrait') return GROOVE;
  const x = PORTRAIT_MARGIN + 4;
  return { x, y: layout.playfield.top - 18, w: layout.stage.width - 2 * x, h: 10 };
}

/**
 * The portrait HUD column right of the BGA monitor (`bga`, or a monitor-sized stand-in when the layout has none), from
 * the monitor's top to its bottom, split into the song plate, the score panel, and the judgement tally.
 */
export function resolvePortraitHUDColumn(
  stage: { width: number },
  bga: BeMusicRect | undefined,
): { plate: BeMusicRect; score: BeMusicRect; tally: BeMusicRect } {
  const monitor = bga && bga.w > 0 ? bga : { x: PORTRAIT_MARGIN, y: 46, w: 206, h: 206 };
  const x = monitor.x + monitor.w + PORTRAIT_MARGIN;
  const w = stage.width - PORTRAIT_MARGIN - x;
  const top = monitor.y;
  const bottom = monitor.y + monitor.h;
  const gap = 8;
  const plateH = 58;
  const tallyH = 64;
  const plate = { x, y: top, w, h: plateH };
  const tally = { x, y: bottom - tallyH, w, h: tallyH };
  const scoreY = top + plateH + gap;
  const score = { x, y: scoreY, w, h: tally.y - gap - scoreY };
  return { plate, score, tally };
}

/** Height of the judgement tally panel in the landscape side column (it starts 6 px above the BGA band). */
export const TALLY_HEIGHT = 186;

/**
 * Where a combo milestone plays when the layout has no BGA monitor to play it on (the landscape touch layout, a
 * page-wide keyboard field): the side column under the judgement tally, down to the bottom HUD band — clear of the
 * lanes and of the gauge / score panels. `undefined` when there is a monitor, on a portrait stage (which always has
 * one), or when the playfield reaches into the side column.
 */
export function resolveMilestoneSpot(
  layout: Pick<BeMusicGameplayLayout, 'orientation' | 'bga' | 'playfield'>,
): { x: number; y: number; w: number } | undefined {
  if (layout.orientation === 'portrait' || (layout.bga && layout.bga.w > 0)) return undefined;
  if (layout.playfield.right > STAGE_SIDE_COLUMN.x) return undefined;
  const top = STAGE_BGA_BAND.top - 6 + TALLY_HEIGHT;
  return {
    x: STAGE_SIDE_COLUMN.x + STAGE_SIDE_COLUMN.w / 2,
    y: Math.round((top + STAGE_BGA_BAND.bottom) / 2) - 10,
    w: STAGE_SIDE_COLUMN.w,
  };
}
