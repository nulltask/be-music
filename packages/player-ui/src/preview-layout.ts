import { STAGE_MARGIN, type BeMusicRect } from '@be-music/player-skin-sdk';

/** Between the lanes and the BGA, and between the BGA and the chart's facts beside it. */
export const PREVIEW_GUTTER = 24;
/** The share of the stage's height the video controls take along its bottom; nothing else is laid out there. */
export const PREVIEW_CONTROLS_RATIO = 0.14;
/** The narrowest the chart's facts get when they sit beside the BGA. */
export const PREVIEW_INFO_MIN_WIDTH = 200;
/** The height the chart's facts take when they sit under the BGA, with the gap above them. */
export const PREVIEW_INFO_BELOW_HEIGHT = 140;

/** A preview's stage and what is laid out on it, in stage pixels. */
export interface PreviewLayout {
  readonly stage: { readonly width: number; readonly height: number };
  readonly bga?: BeMusicRect | undefined;
  readonly playfield: { readonly right: number };
}

/** Where a preview puts the chart's facts, in stage pixels. */
export interface PreviewInfoBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The bottom of the area above the video controls, in stage pixels. */
export function previewContentBottom(stageHeight: number): number {
  return Math.round(stageHeight * (1 - PREVIEW_CONTROLS_RATIO));
}

/**
 * The largest BGA square right of the lanes and above the video controls, with the chart's facts beside it when the
 * lanes leave room for them there, and under it otherwise, whichever gives the larger BGA.
 */
export function resolvePreviewBGARect(stage: PreviewLayout['stage'], playfieldRight: number): BeMusicRect {
  const left = Math.max(STAGE_MARGIN, playfieldRight + PREVIEW_GUTTER);
  const right = stage.width - STAGE_MARGIN;
  const top = STAGE_MARGIN;
  const roomWidth = right - left;
  const roomHeight = previewContentBottom(stage.height) - top;
  const beside = Math.min(roomHeight, roomWidth - PREVIEW_GUTTER - PREVIEW_INFO_MIN_WIDTH);
  const below = Math.min(roomWidth, roomHeight - PREVIEW_INFO_BELOW_HEIGHT);
  if (beside >= below) return { x: left, y: top, w: Math.max(0, beside), h: Math.max(0, beside) };
  const size = Math.max(0, below);
  return { x: Math.round(left + (roomWidth - size) / 2), y: top, w: size, h: size };
}

/**
 * Where the chart's facts go: beside the BGA when it leaves them room on its right (as `resolvePreviewBGARect` lays it
 * out for narrow lanes), under it otherwise, and right of the lanes when there is no BGA.
 */
export function resolvePreviewInfoBox(layout: PreviewLayout): PreviewInfoBox {
  const { stage, bga, playfield } = layout;
  const bottom = previewContentBottom(stage.height);
  const right = stage.width - STAGE_MARGIN;
  if (bga === undefined) return { left: playfield.right + PREVIEW_GUTTER, top: STAGE_MARGIN, right, bottom };
  const bgaRight = bga.x + bga.w;
  if (right - bgaRight >= PREVIEW_GUTTER + PREVIEW_INFO_MIN_WIDTH) {
    return { left: bgaRight + PREVIEW_GUTTER, top: bga.y, right, bottom };
  }
  return { left: bga.x, top: bga.y + bga.h + 12, right: bgaRight, bottom };
}
