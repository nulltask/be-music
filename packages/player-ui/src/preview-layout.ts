import { STAGE_MARGIN, type BeMusicRect } from '@be-music/player-skin-sdk';

/** Between the lanes and the BGA, and between the BGA and the chart's facts beside it. */
export const PREVIEW_GUTTER = 24;
/** The share of the stage's height the video controls take along its bottom; nothing else is laid out there. */
export const PREVIEW_CONTROLS_RATIO = 0.14;
/** The narrowest the chart's facts get when they sit beside the BGA. */
export const PREVIEW_INFO_MIN_WIDTH = 200;
/** The height the chart's facts take when they sit under the BGA, with the gap above them. */
export const PREVIEW_INFO_BELOW_HEIGHT = 140;
/**
 * On a tall stage, the height the chart's facts take in a band under the BGA. The HUD sets their type in proportion to
 * the stage's width there (`PREVIEW_PORTRAIT_FONT_RATIO`), so this holds them at any window size.
 */
export const PREVIEW_PORTRAIT_INFO_HEIGHT = 220;
/** On a tall stage, the HUD's type size as a share of the stage's width: 16 design px on the 480 px wide stage. */
export const PREVIEW_PORTRAIT_FONT_RATIO = 0.034;
/** On a tall stage, the lanes keep at least this much between what is above them and the video controls. */
const PORTRAIT_LANE_MIN = 260;
/** Gap between the BGA (or the facts under it) and the lanes. */
const PORTRAIT_LANE_GAP = 16;
/** Gap between the BGA and the facts under it. */
const PORTRAIT_INFO_GAP = 12;
/** The judgement line sits this far above the video controls. */
const PORTRAIT_JUDGEMENT_INSET = 36;

/**
 * Where a tall stage puts the BGA, the chart's facts and the lanes: the BGA square on top with the facts under it or
 * beside it, and the lanes below both.
 */
export interface PreviewPortraitPlacement {
  readonly bga: BeMusicRect;
  readonly info: PreviewInfoBox;
  readonly laneTop: number;
  readonly judgementY: number;
}

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
 * A stage taller than it is wide: the BGA square across the top, the chart's facts in a band under it or in a column
 * beside it, whichever leaves the larger BGA, and the lanes under both, above the video controls. A stage close to
 * square (a tablet held upright) gets the facts beside the BGA; a phone's gets them under it. `undefined` on a
 * landscape stage.
 */
export function resolvePreviewPortrait(stage: PreviewLayout['stage']): PreviewPortraitPlacement | undefined {
  if (!(stage.height > stage.width)) return undefined;
  const contentBottom = previewContentBottom(stage.height);
  const left = STAGE_MARGIN;
  const right = stage.width - STAGE_MARGIN;
  const top = STAGE_MARGIN;
  const roomWidth = right - left;
  const roomHeight = contentBottom - top - PORTRAIT_LANE_MIN - PORTRAIT_LANE_GAP;
  const under = Math.max(0, Math.min(roomWidth, roomHeight - PORTRAIT_INFO_GAP - PREVIEW_PORTRAIT_INFO_HEIGHT));
  const beside = Math.max(0, Math.min(roomWidth - PREVIEW_GUTTER - PREVIEW_INFO_MIN_WIDTH, roomHeight));
  const judgementY = contentBottom - PORTRAIT_JUDGEMENT_INSET;
  if (under >= beside) {
    const infoTop = top + under + PORTRAIT_INFO_GAP;
    const infoBottom = infoTop + PREVIEW_PORTRAIT_INFO_HEIGHT;
    return {
      bga: { x: Math.round(left + (roomWidth - under) / 2), y: top, w: under, h: under },
      info: { left, top: infoTop, right, bottom: infoBottom },
      laneTop: infoBottom + PORTRAIT_LANE_GAP,
      judgementY,
    };
  }
  const bgaRight = left + beside;
  return {
    bga: { x: left, y: top, w: beside, h: beside },
    info: { left: bgaRight + PREVIEW_GUTTER, top, right, bottom: top + beside },
    laneTop: top + beside + PORTRAIT_LANE_GAP,
    judgementY,
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
 * out for narrow lanes), under it otherwise, and right of the lanes when there is no BGA. A tall stage gives them their
 * own band or column ({@link resolvePreviewPortrait}).
 */
export function resolvePreviewInfoBox(layout: PreviewLayout): PreviewInfoBox {
  const { stage, bga, playfield } = layout;
  const portrait = resolvePreviewPortrait(stage);
  if (portrait) return portrait.info;
  const bottom = previewContentBottom(stage.height);
  const right = stage.width - STAGE_MARGIN;
  if (bga === undefined) return { left: playfield.right + PREVIEW_GUTTER, top: STAGE_MARGIN, right, bottom };
  const bgaRight = bga.x + bga.w;
  if (right - bgaRight >= PREVIEW_GUTTER + PREVIEW_INFO_MIN_WIDTH) {
    return { left: bgaRight + PREVIEW_GUTTER, top: bga.y, right, bottom };
  }
  return { left: bga.x, top: bga.y + bga.h + 12, right: bgaRight, bottom };
}
