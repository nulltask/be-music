import { STAGE_MARGIN, type BeMusicRect } from '@be-music/player-skin-sdk';

/** Between the lanes and the BGA, and between the BGA and the chart's facts beside it. */
export const PREVIEW_GUTTER = 24;
/** The share of the stage's height the video controls take along its bottom; nothing else is laid out there. */
export const PREVIEW_CONTROLS_RATIO = 0.14;
/** The narrowest the chart's facts get when they sit beside the BGA. */
export const PREVIEW_INFO_MIN_WIDTH = 200;
/** The height the chart's facts take when they sit under the BGA, with the gap above them. */
export const PREVIEW_INFO_BELOW_HEIGHT = 140;
/** On a tall stage, the lanes keep at least this much between the BGA and the video controls. */
const PORTRAIT_LANE_MIN = 260;
/** Gap between the BGA and the lanes under it. */
const PORTRAIT_LANE_GAP = 16;
/** The judgement line sits this far above the video controls. */
const PORTRAIT_JUDGEMENT_INSET = 36;

/** Where a tall stage puts the BGA and the lanes: the BGA square on top, the lanes below it. */
export interface PreviewPortraitPlacement {
  readonly bga: BeMusicRect;
  readonly laneTop: number;
  readonly judgementY: number;
}

/** A preview's stage and what is laid out on it, in stage pixels. */
export interface PreviewLayout {
  readonly stage: { readonly width: number; readonly height: number };
  readonly bga?: BeMusicRect | undefined;
  /** `top` is the lanes' top, set when they sit under the BGA. */
  readonly playfield: { readonly right: number; readonly top?: number };
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
 * A stage taller than it is wide: the largest BGA square across the top, and the lanes in the band under it, above
 * the video controls. `undefined` on a landscape stage.
 */
export function resolvePreviewPortrait(stage: PreviewLayout['stage']): PreviewPortraitPlacement | undefined {
  if (!(stage.height > stage.width)) return undefined;
  const contentBottom = previewContentBottom(stage.height);
  const roomWidth = stage.width - STAGE_MARGIN * 2;
  const roomHeight = contentBottom - STAGE_MARGIN;
  const size = Math.max(0, Math.min(roomWidth, roomHeight - PORTRAIT_LANE_MIN - PORTRAIT_LANE_GAP));
  return {
    bga: {
      x: Math.round(STAGE_MARGIN + (roomWidth - size) / 2),
      y: STAGE_MARGIN,
      w: size,
      h: size,
    },
    laneTop: STAGE_MARGIN + size + PORTRAIT_LANE_GAP,
    judgementY: contentBottom - PORTRAIT_JUDGEMENT_INSET,
  };
}

/**
 * The largest BGA square right of the lanes and above the video controls, with the chart's facts beside it when the
 * lanes leave room for them there, and under it otherwise, whichever gives the larger BGA. A stage taller than it is
 * wide puts that square across the top instead ({@link resolvePreviewPortrait}).
 */
export function resolvePreviewBGARect(stage: PreviewLayout['stage'], playfieldRight: number): BeMusicRect {
  const portrait = resolvePreviewPortrait(stage);
  if (portrait) return portrait.bga;
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
 * out for narrow lanes), under it otherwise, and right of the lanes when there is no BGA. When the lanes sit under the
 * BGA, the facts stay on the bottom of the BGA so they do not cover the lanes.
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
  const underTop = bga.y + bga.h + 12;
  if (playfield.top !== undefined && underTop > playfield.top - 8) {
    const band = Math.min(PREVIEW_INFO_BELOW_HEIGHT, bga.h);
    return { left: bga.x, top: bga.y + bga.h - band, right: bgaRight, bottom: bga.y + bga.h };
  }
  return { left: bga.x, top: underTop, right: bgaRight, bottom };
}
