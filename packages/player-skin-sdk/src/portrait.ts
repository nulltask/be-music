import type { ChartPlayVariant } from '@be-music/chart-model';
import {
  _____LANE_WIDTHS,
  isScratchLaneForVariant,
  resolveFallbackLaneLayout,
  uses____LaneWidths,
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
  /** Width the standard layout's 7 KEY lanes (That-Which-Must-Not-Be-Named key widths, scaled) take. */
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
 * A fluid stage ({@link BeMusicStage.resize}) comes back resized to the screen's aspect ratio
 * ({@link resolveFluidStage}).
 */
export function resolveBeMusicStage(
  skin: Pick<BeMusicSkin, 'stage' | 'portraitStage'>,
  screen: { width: number; height: number },
  chart?: { laneChannels?: readonly string[]; playVariant?: ChartPlayVariant },
): BeMusicStage {
  const landscape = skin.stage ?? wideStage;
  const portrait = skin.portraitStage;
  // A fixed stage (every skin but a fluid one) is returned as is, without the fluid sizing's call.
  const stage =
    !portrait ||
    resolveStageOrientation(screen) !== 'portrait' ||
    (chart && !supportsPortraitLayout(chart.laneChannels, chart.playVariant))
      ? landscape
      : portrait;
  return stage.resize ? resolveFluidStage(stage, screen) : stage;
}

/**
 * The design size a fluid `stage` takes on `screen`: the stage's short side kept (so type and lane sizes stay what the
 * skin drew them at) and its long side stretched or shrunk to the screen's aspect ratio, rounded to whole design px.
 * `undefined` when the screen is turned the other way from the stage, or has no area.
 */
export function resolveFluidStageSize(
  stage: { width: number; height: number },
  screen: { width: number; height: number },
): { width: number; height: number } | undefined {
  if (!(screen.width > 0 && screen.height > 0)) return undefined;
  if (resolveStageOrientation(screen) !== resolveStageOrientation(stage)) return undefined;
  const short = Math.min(stage.width, stage.height);
  return resolveStageOrientation(screen) === 'portrait'
    ? { width: short, height: Math.round((short * screen.height) / screen.width) }
    : { width: Math.round((short * screen.width) / screen.height), height: short };
}

/** The last stage each fluid stage was resized to, so a screen that keeps its size keeps getting the same object. */
const fluidStages = new WeakMap<BeMusicStage, BeMusicStage>();

/**
 * `stage` resized to `screen` ({@link resolveFluidStageSize}) when it is fluid ({@link BeMusicStage.resize}), `stage`
 * itself otherwise. The resized stage is kept while the size holds: hosts cache lane layouts by stage identity, so a
 * new object only appears when the screen's aspect ratio changes.
 */
export function resolveFluidStage(stage: BeMusicStage, screen: { width: number; height: number }): BeMusicStage {
  if (!stage.resize) return stage;
  const size = resolveFluidStageSize(stage, screen);
  if (!size) return stage;
  const last = fluidStages.get(stage);
  if (last && last.width === size.width && last.height === size.height) return last;
  const resized = stage.resize(size);
  fluidStages.set(stage, resized);
  return resized;
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
 * cabinet's key widths (That-Which-Must-Not-Be-Named scratch / white / black, scaled so 7 KEY spans
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
    // 194 px: the LR2 7 KEY playfield the That-Which-Must-Not-Be-Named key widths add up to (a scratch, four white and three black keys).
    const k = span / (_____LANE_WIDTHS.scratch + 4 * _____LANE_WIDTHS.white + 3 * _____LANE_WIDTHS.black);
    placed = resolveFallbackLaneLayout({
      channels,
      laneCount,
      playVariant,
      x: 0,
      w: span,
      fixedWidths: uses____LaneWidths(playVariant)
        ? {
            scratch: _____LANE_WIDTHS.scratch * k,
            white: _____LANE_WIDTHS.white * k,
            black: _____LANE_WIDTHS.black * k,
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
