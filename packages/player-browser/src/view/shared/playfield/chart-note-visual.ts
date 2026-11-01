/**
 * Screen placement of one note under the chart-authored HIDDEN, CHANGE-HS and CRAZY families (#843), shared by the
 * LR2 / built-in playfield and the beatoraja note layer. The formulas themselves live in `@be-music/chart-model`
 * (`resolveChartNoteVisual`); this maps a note's scrolled y between the judgement line and the lane top onto their
 * progress scale and back.
 */

import { hasChartVisualOptions, resolveChartNoteVisual, type ChartOptionState } from '@be-music/chart-model';

export interface ChartNoteScreenVisual {
  /** Screen y after CHANGE-HS (the note's bottom edge, as the scrolled y it replaces). */
  y: number;
  /** HIDDEN opacity multiplier; a renderer skips the note at 0. */
  alpha: number;
  /** CRAZY size multiplier about the lane centre and the note's bottom edge. */
  scale: number;
  /** CRAZY wave offset in screen pixels. */
  xOffset: number;
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

/** True when `state` changes how notes draw (any family beyond HI-SPEED). */
export function hasChartNoteVisual(state: ChartOptionState | undefined): state is ChartOptionState {
  return hasChartVisualOptions(state);
}

/** Places one note. Identity when `state` carries no visual family or the lane has no height. */
export function placeChartNoteVisual(
  state: ChartOptionState | undefined,
  input: ChartNoteScreenInput,
): ChartNoteScreenVisual {
  const height = input.judgementY - input.laneTopY;
  if (!hasChartVisualOptions(state) || !(height > 0)) return { y: input.y, alpha: 1, scale: 1, xOffset: 0 };
  const visual = resolveChartNoteVisual(state, {
    progress: (input.judgementY - input.y) / height,
    channel: input.channel,
    beat: input.beat,
    seconds: input.seconds,
    ...(input.combo !== undefined ? { combo: input.combo } : {}),
  });
  return {
    y: input.judgementY - visual.progress * height,
    alpha: visual.alpha,
    scale: visual.scale,
    xOffset: visual.xOffset * input.laneWidth,
  };
}
