import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { PLAYFIELD } from './playfield.ts';
import {
  isScratchLaneForVariant,
  resolveFallbackLaneLayout,
  resolveSkinlessLaneLayout,
  type FallbackLaneLayoutRect,
} from './lane-geometry.ts';
import type { GameplayLayoutMode } from './types.ts';

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
  top: 0,
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
 * The lane geometry for `mode`: the standard layout ({@link resolveSkinlessLaneLayout} under the LR2 7K judgement
 * line), or the touch layout when asked for and the play mode supports it ({@link supportsTouchLayout}).
 */
export function resolveGameplayLaneGeometry(
  channels: readonly string[] | undefined,
  laneCount: number | undefined,
  playVariant: ChartPlayVariant | undefined,
  mode: GameplayLayoutMode = 'standard',
): GameplayLaneGeometry {
  if (mode === 'touch' && supportsTouchLayout(playVariant)) {
    return {
      mode: 'touch',
      ...resolveTouchLaneLayout(channels, laneCount, playVariant),
      top: TOUCH_PLAYFIELD.top,
      judgementY: TOUCH_PLAYFIELD.judgementY,
    };
  }
  return {
    mode: 'standard',
    ...resolveSkinlessLaneLayout(channels, laneCount, playVariant),
    top: PLAYFIELD.y,
    judgementY: PLAYFIELD.judgementY,
  };
}
