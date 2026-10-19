import type { ChartPlayVariant } from '@be-music/chart';
import {
  IIDX_LANE_WIDTHS,
  isScratchLaneForVariant,
  resolveFallbackLaneLayout,
  usesIIDXLaneWidths,
  type FallbackLaneLayoutRect,
} from './lane-geometry.ts';
import { wideStage } from './stage.ts';
import type {
  BeMusicRect,
  BeMusicSelectLayout,
  BeMusicSelectSkin,
  BeMusicSkin,
  BeMusicStage,
  BeMusicStageOrientation,
  GameplayLayoutMode,
} from './types.ts';

/**
 * The 9:16 portrait design canvas: the built-in {@link wideStage} turned on its side, so its 480 px side (and the type
 * sizes chrome is drawn at) stays the same. 9:16 sits between the screens it is shown on: a phone browser's viewport
 * once its toolbars take their share (about 9:16 to 9:19.5) letterboxes a little above and below, and a 3:4 tablet
 * pillarboxes at the sides.
 */
export const TALL_STAGE_WIDTH = 480;
export const TALL_STAGE_HEIGHT = 854;

/**
 * Geometry of the portrait playfield on the 480x854 {@link tallStage}, in design px (other portrait stages scale it to
 * their size). The lanes span the stage's width in its lower part — below the BGA and the HUD — with the judgement line
 * low: in the touch layout it leaves a band under the line for the thumbs; the standard layout keeps it near the
 * bottom edge.
 */
export const PORTRAIT_PLAYFIELD = {
  /** Side margin of the touch lanes. */
  margin: 12,
  /** Top of the lanes: the BGA, gauge and HUD take the band above. */
  top: 300,
  judgementY: { touch: 740, standard: 786 },
  /** Widest a touch key gets, so a chart with few lanes does not stretch them across the stage (78 CSS px on a phone). */
  maxKeyWidth: 96,
  /** A touch scratch lane is this many keys wide. */
  scratchWeight: 1.4,
  /** Width the standard layout's 7 KEY lanes (IIDX key widths, scaled) take. */
  standardWidth: 374,
} as const;

/**
 * The BGA square on the {@link tallStage}: top left, under a 40 px header band and beside a HUD column on the right,
 * leaving a band above the lanes (for a gauge).
 */
export const TALL_STAGE_BGA: BeMusicRect = { x: 12, y: 46, w: 206, h: 206 };

/** The portrait stage the built-in skins declare as their {@link BeMusicSkin.portraitStage}. */
export const tallStage: BeMusicStage = {
  width: TALL_STAGE_WIDTH,
  height: TALL_STAGE_HEIGHT,
  resolveBGARect: () => ({ ...TALL_STAGE_BGA }),
};

/** `'portrait'` for a size taller than wide, `'landscape'` otherwise (a square counts as landscape). */
export function resolveStageOrientation(size: { width: number; height: number }): BeMusicStageOrientation {
  return size.height > size.width ? 'portrait' : 'landscape';
}

/**
 * Whether a chart can be played on a portrait stage: single play with at most 9 lanes (5 / 7 KEY, 9 KEY PMS). Double
 * play (10 / 14 KEY) would leave fingers lanes a third of a thumb wide and the keyboard modes (24 / 48 KEY) are played
 * on a controller, so those stay on the landscape stage. Without a play variant the lane count decides.
 */
export function supportsPortraitLayout(
  laneChannels: readonly string[] | undefined,
  playVariant?: ChartPlayVariant,
): boolean {
  if (playVariant !== undefined) return playVariant === '5' || playVariant === '7' || playVariant === '9';
  return (laneChannels?.length ?? 0) <= 9;
}

/**
 * The stage to draw `skin` on for a `screen` (the canvas, in CSS px): its {@link BeMusicSkin.portraitStage} when it has
 * one and the screen is taller than wide — and, for gameplay (`chart` given), the chart fits a portrait playfield
 * ({@link supportsPortraitLayout}) — otherwise its {@link BeMusicSkin.stage} (the 16:9 {@link wideStage} by default).
 */
export function resolveBeMusicStage(
  skin: Pick<BeMusicSkin, 'stage' | 'portraitStage'>,
  screen: { width: number; height: number },
  chart?: { laneChannels?: readonly string[]; playVariant?: ChartPlayVariant },
): BeMusicStage {
  const landscape = skin.stage ?? wideStage;
  const portrait = skin.portraitStage;
  if (!portrait || resolveStageOrientation(screen) !== 'portrait') return landscape;
  if (chart && !supportsPortraitLayout(chart.laneChannels, chart.playVariant)) return landscape;
  return portrait;
}

/** The select skin's song-list geometry for `stage`: its `portraitLayout` on a portrait stage when it has one. */
export function resolveBeMusicSelectLayout(
  select: Pick<BeMusicSelectSkin, 'layout' | 'portraitLayout'>,
  stage: { width: number; height: number },
): BeMusicSelectLayout {
  return resolveStageOrientation(stage) === 'portrait' ? (select.portraitLayout ?? select.layout) : select.layout;
}

/** Lane geometry of a portrait playfield. */
export interface PortraitLaneGeometry {
  lanes: FallbackLaneLayoutRect[];
  left: number;
  right: number;
  top: number;
  judgementY: number;
}

/**
 * Lane rects for a portrait `stage` ({@link PORTRAIT_PLAYFIELD}, scaled from the 480x854 {@link tallStage}), centred
 * across it. `'touch'` gives every key the same width and a scratch {@link PORTRAIT_PLAYFIELD.scratchWeight} keys wide,
 * filling the stage between its margins (keys at most {@link PORTRAIT_PLAYFIELD.maxKeyWidth}); `'standard'` keeps the
 * cabinet's key widths (IIDX scratch / white / black, scaled so 7 KEY spans
 * {@link PORTRAIT_PLAYFIELD.standardWidth}), or equal keys across that width for 9 KEY. Lane order follows the
 * standard layout.
 */
export function resolvePortraitLaneLayout(
  channels: readonly string[] | undefined,
  laneCount: number | undefined,
  playVariant: ChartPlayVariant | undefined,
  mode: GameplayLayoutMode,
  stage: { width: number; height: number },
): PortraitLaneGeometry {
  const sx = stage.width / TALL_STAGE_WIDTH;
  const sy = stage.height / TALL_STAGE_HEIGHT;
  const top = PORTRAIT_PLAYFIELD.top * sy;
  const judgementY = PORTRAIT_PLAYFIELD.judgementY[mode] * sy;
  let placed: FallbackLaneLayoutRect[];
  if (mode === 'touch') {
    const count = channels && channels.length > 0 ? channels.length : Math.max(1, Math.trunc(laneCount ?? 8));
    const scratchCount = channels
      ? channels.filter((channel) => isScratchLaneForVariant(channel, playVariant)).length
      : 0;
    const span = stage.width - 2 * PORTRAIT_PLAYFIELD.margin * sx;
    const weight = count - scratchCount + scratchCount * PORTRAIT_PLAYFIELD.scratchWeight;
    const key = Math.min(PORTRAIT_PLAYFIELD.maxKeyWidth * sx, span / weight);
    placed = resolveFallbackLaneLayout({
      channels,
      laneCount,
      playVariant,
      x: 0,
      w: span,
      fixedWidths: { scratch: key * PORTRAIT_PLAYFIELD.scratchWeight, white: key, black: key },
    });
  } else {
    const span = PORTRAIT_PLAYFIELD.standardWidth * sx;
    // 194 px: the LR2 7 KEY playfield the IIDX key widths add up to (a scratch, four white and three black keys).
    const k = span / (IIDX_LANE_WIDTHS.scratch + 4 * IIDX_LANE_WIDTHS.white + 3 * IIDX_LANE_WIDTHS.black);
    placed = resolveFallbackLaneLayout({
      channels,
      laneCount,
      playVariant,
      x: 0,
      w: span,
      fixedWidths: usesIIDXLaneWidths(playVariant)
        ? {
            scratch: IIDX_LANE_WIDTHS.scratch * k,
            white: IIDX_LANE_WIDTHS.white * k,
            black: IIDX_LANE_WIDTHS.black * k,
          }
        : undefined,
    });
  }
  const width = Math.max(0, ...placed.map((lane) => lane.x + lane.w));
  const left = (stage.width - width) / 2;
  return {
    lanes: placed.map((lane) => ({ ...lane, x: lane.x + left })),
    left,
    right: left + width,
    top,
    judgementY,
  };
}
