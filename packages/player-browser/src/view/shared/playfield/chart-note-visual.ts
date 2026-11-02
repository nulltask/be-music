/**
 * Screen placement of one note under the chart-authored HIDDEN, CHANGE-HS and CRAZY families (#843, #931), shared by
 * the LR2 / built-in playfield and the beatoraja note layer. The formulas themselves live in `@be-music/chart-model`
 * (`resolveChartNoteVisual`, `resolveChartPlayfieldVisual`); this maps a note's scrolled y between the judgement line
 * and the lane top onto their progress scale and back, and mirrors a note layer for REVERSE.
 */

import { hasChartVisualOptions, resolveChartNoteVisual, type ChartOptionState } from '@be-music/chart-model';

/** One CLONE afterimage on screen. */
export interface ChartNoteScreenClone {
  /** Screen y of the afterimage's bottom edge. */
  y: number;
  /** Horizontal offset in screen pixels, the note's own sway included. */
  xOffset: number;
  /** Opacity multiplier on top of the note's own. */
  alpha: number;
}

export interface ChartNoteScreenVisual {
  /** Screen y after CHANGE-HS and the Y wave (the note's bottom edge, as the scrolled y it replaces). */
  y: number;
  /** HIDDEN opacity multiplier; a renderer skips the note at 0. */
  alpha: number;
  /** CRAZY size (and 3D wave) multiplier about the lane centre and the note's bottom edge. */
  scale: number;
  /** CRAZY wave offset in screen pixels. */
  xOffset: number;
  /** STAR colour (`0xRRGGBB`), multiplied into the note; absent = its own. */
  tint?: number;
  /** SPIN rotation in radians about the note's centre. */
  rotation: number;
  /** CLONE afterimages, drawn behind the note. */
  clones: readonly ChartNoteScreenClone[];
}

export interface ChartNoteScreenInput {
  /** The note's scrolled y before any chart option. */
  y: number;
  judgementY: number;
  laneTopY: number;
  laneWidth: number;
  channel: string;
  beat: number;
  /** Display chart seconds. */
  seconds: number;
  combo?: number;
}

const NO_CLONES: readonly ChartNoteScreenClone[] = [];

/** True when `state` changes how notes draw (any per-note family beyond HI-SPEED). */
export function hasChartNoteVisual(state: ChartOptionState | undefined): state is ChartOptionState {
  return hasChartVisualOptions(state);
}

/** Places one note. Identity when `state` carries no per-note family or the lane has no height. */
export function placeChartNoteVisual(
  state: ChartOptionState | undefined,
  input: ChartNoteScreenInput,
): ChartNoteScreenVisual {
  const height = input.judgementY - input.laneTopY;
  if (!hasChartVisualOptions(state) || !(height > 0))
    return { y: input.y, alpha: 1, scale: 1, xOffset: 0, rotation: 0, clones: NO_CLONES };
  const visual = resolveChartNoteVisual(state, {
    progress: (input.judgementY - input.y) / height,
    channel: input.channel,
    beat: input.beat,
    seconds: input.seconds,
    ...(input.combo !== undefined ? { combo: input.combo } : {}),
  });
  const xOffset = visual.xOffset * input.laneWidth;
  return {
    y: input.judgementY - visual.progress * height,
    alpha: visual.alpha,
    scale: visual.scale,
    xOffset,
    ...(visual.tint !== undefined ? { tint: visual.tint } : {}),
    rotation: visual.rotation,
    clones:
      visual.clones.length === 0
        ? NO_CLONES
        : visual.clones.map((clone) => ({
            y: input.judgementY - clone.progress * height,
            xOffset: xOffset + clone.xOffset * input.laneWidth,
            alpha: clone.alpha,
          })),
  };
}

/** A container a REVERSE flip mirrors: its vertical scale and position. */
export interface ReversibleLayer {
  readonly scale: { y: number };
  readonly position: { y: number };
}

/**
 * Mirrors `layer` about the middle of the lane area from `top` to `bottom` while `reverse` holds (REVERSE: notes rise
 * from the judgement line's mirror at the lane top), and puts it back otherwise. A point at `y` draws at
 * `top + bottom − y`.
 */
export function applyChartReverse(layer: ReversibleLayer, reverse: boolean, top: number, bottom: number): void {
  if (reverse && Number.isFinite(top) && Number.isFinite(bottom)) {
    layer.scale.y = -1;
    layer.position.y = top + bottom;
  } else if (layer.scale.y !== 1 || layer.position.y !== 0) {
    layer.scale.y = 1;
    layer.position.y = 0;
  }
}
