import type { ChartPlayVariant } from '@be-music/chart-model';
import { PLAYFIELD } from './playfield.ts';
import {
  isScratchLaneForVariant,
  resolveFallbackLaneLayout,
  resolveSkinlessLaneLayout,
  type FallbackLaneLayoutRect,
} from './lane-geometry.ts';
import { resolvePortraitLaneLayout, resolveStageOrientation } from './portrait.ts';
import type { BeMusicStage, BeMusicStageOrientation, GameplayLayoutMode } from './types.ts';

/**
 * Geometry of the touch layout on the 854x480 stage, in design px. The lanes take the stage from its left margin up to
 * the judgement tally's column ({@link STAGE_SIDE_COLUMN} starts at 746), keys are one width each (fingers do not care
 * which key is black) capped so a 5K chart does not grow keys wider than a thumb. The judgement line sits a little
 * lower than the standard one but stays above the bottom HUD band (from {@link STAGE_BGA_BAND}'s bottom, 340), so the
 * built-in skins' gauge / score panels are not covered by the wider lanes; fingers press the lanes anywhere from the
 * lower part of the lane down to the stage bottom, so the band under the line is still part of each lane's touch zone.
 */
export const TOUCH_PLAYFIELD = {
  left: 16,
  right: 730,
  /** Below the header band the built-in skins draw along the top of the stage (at most 44 px tall). */
  top: 48,
  judgementY: 330,
  /** Widest a key gets, about 58 CSS px on a landscape phone (stage scale 0.81). */
  maxKeyWidth: 72,
  /** A scratch lane is this many keys wide. */
  scratchWeight: 1.4,
  /** Gap between the 1P and 2P banks in double play. */
  sideGap: 24,
} as const;

/** Lane geometry of a playfield in either layout mode. */
export interface GameplayLaneGeometry {
  /** The layout actually used: `'touch'` falls back to `'standard'` for play modes the touch layout does not cover. */
  mode: GameplayLayoutMode;
  /** The orientation of the stage the geometry was laid out for. */
  orientation: BeMusicStageOrientation;
  lanes: FallbackLaneLayoutRect[];
  /** Left edge of the leftmost lane / right edge of the rightmost lane. */
  left: number;
  right: number;
  /** Top of the lanes and the judgement line notes land on. */
  top: number;
  judgementY: number;
}

/**
 * Whether the touch layout covers `playVariant`: the IIDX (5 / 7 / 10 / 14 KEY) and PMS (9 KEY) modes. The 24 / 48 KEY
 * keyboard modes are played on a keyboard or MIDI controller and keep the standard layout.
 */
export function supportsTouchLayout(playVariant?: ChartPlayVariant): boolean {
  return playVariant !== '24' && playVariant !== '48';
}

/**
 * Lane rects for the touch layout: every key the same width and a scratch {@link TOUCH_PLAYFIELD.scratchWeight} keys
 * wide, sized to fill the touch span (keys at most {@link TOUCH_PLAYFIELD.maxKeyWidth}) and centred in it. Double play
 * keeps a {@link TOUCH_PLAYFIELD.sideGap} between the banks. Lane order follows the standard layout.
 */
export function resolveTouchLaneLayout(
  channels: readonly string[] | undefined,
  laneCount: number | undefined,
  playVariant?: ChartPlayVariant,
): { lanes: FallbackLaneLayoutRect[]; left: number; right: number } {
  const count = channels && channels.length > 0 ? channels.length : Math.max(1, Math.trunc(laneCount ?? 8));
  const scratchCount = channels
    ? channels.filter((channel) => isScratchLaneForVariant(channel, playVariant)).length
    : 0;
  const doublePlay = playVariant !== '9' && channels?.some((channel) => channel.startsWith('2')) === true;
  const sideGap = doublePlay ? TOUCH_PLAYFIELD.sideGap : 0;
  const span = TOUCH_PLAYFIELD.right - TOUCH_PLAYFIELD.left;
  const weight = count - scratchCount + scratchCount * TOUCH_PLAYFIELD.scratchWeight;
  const key = Math.min(TOUCH_PLAYFIELD.maxKeyWidth, (span - sideGap) / weight);
  const placed = resolveFallbackLaneLayout({
    channels,
    laneCount,
    playVariant,
    x: 0,
    w: span,
    sideGap,
    fixedWidths: { scratch: key * TOUCH_PLAYFIELD.scratchWeight, white: key, black: key },
  });
  const width = Math.max(0, ...placed.map((lane) => lane.x + lane.w));
  const left = TOUCH_PLAYFIELD.left + (span - width) / 2;
  return { lanes: placed.map((lane) => ({ ...lane, x: lane.x + left })), left, right: left + width };
}

/**
 * The lane geometry for `mode` on `stage` (the 854x480 landscape stage when omitted). On a landscape stage: the
 * standard layout ({@link resolveSkinlessLaneLayout} under the LR2 7K judgement line), or the touch layout when asked
 * for and the play mode supports it ({@link supportsTouchLayout}). On a portrait stage: the portrait playfield in either
 * mode ({@link resolvePortraitLaneLayout}); hosts only put charts that fit one (`supportsPortraitLayout`) on a portrait
 * stage.
 */
export function resolveGameplayLaneGeometry(
  channels: readonly string[] | undefined,
  laneCount: number | undefined,
  playVariant: ChartPlayVariant | undefined,
  mode: GameplayLayoutMode = 'standard',
  stage?: Pick<BeMusicStage, 'width' | 'height' | 'playfield'>,
): GameplayLaneGeometry {
  let geometry: GameplayLaneGeometry;
  if (stage && resolveStageOrientation(stage) === 'portrait') {
    geometry = {
      mode,
      orientation: 'portrait',
      ...resolvePortraitLaneLayout(channels, laneCount, playVariant, mode, stage),
    };
  } else if (mode === 'touch' && supportsTouchLayout(playVariant)) {
    geometry = {
      mode: 'touch',
      orientation: 'landscape',
      ...resolveTouchLaneLayout(channels, laneCount, playVariant),
      top: TOUCH_PLAYFIELD.top,
      judgementY: TOUCH_PLAYFIELD.judgementY,
    };
  } else {
    geometry = {
      mode: 'standard',
      orientation: 'landscape',
      ...resolveSkinlessLaneLayout(channels, laneCount, playVariant),
      top: PLAYFIELD.y,
      judgementY: PLAYFIELD.judgementY,
    };
  }
  const bounds = stage?.playfield?.[geometry.mode];
  if (!bounds) return geometry;
  const right = bounds.maxRight === undefined ? geometry.right : Math.min(geometry.right, bounds.maxRight);
  const scale = (right - geometry.left) / (geometry.right - geometry.left || 1);
  return {
    ...geometry,
    top: bounds.top,
    judgementY: bounds.judgementY,
    right,
    lanes:
      scale === 1
        ? geometry.lanes
        : geometry.lanes.map((lane) => ({
            ...lane,
            x: geometry.left + (lane.x - geometry.left) * scale,
            w: lane.w * scale,
          })),
  };
}
