/**
 * Terminal presentation of the chart-authored display families (#843, #931). A character grid has no opacity, colour
 * cycle, rotation or sub-cell size, so a note shows while its HIDDEN opacity is at least one half, CHANGE-HS and the Y
 * wave (`YWAVE*`, `XYWAVE*`) move it along the lane, and the CRAZY size, X wave, 3D wave, STAR, SPIN and CLONE effects
 * are not drawn (they change nothing but the browser's sprites). The playfield-level options are `tui.ts`'s: REVERSE
 * flips the grid, HIDJUDGE blanks the judge line and DARK hides the BGA.
 */

import { resolveChartNoteVisual, type ChartOptionState } from '@be-music/chart-model';

export interface TUIChartNotePlacement {
  /** Approach distance after CHANGE-HS and the Y wave, in the grid's scroll-window units. */
  distance: number;
  /** False when HIDDEN hides the note in the grid. */
  visible: boolean;
}

/** Opacity at or above which a terminal cell still shows a note. */
export const TUI_CHART_HIDDEN_VISIBLE_ALPHA = 0.5;

/** True when `state` moves or hides notes on the grid: HIDDEN (not M-SUDDEN), CHANGE-HS or a Y wave. */
function movesGridNotes(state: ChartOptionState): boolean {
  return (
    (state.hidden !== undefined && state.hidden !== 'M-SUDDEN') ||
    state.changeHS !== undefined ||
    state.crazyWave === 'YWAVE' ||
    state.crazyWave === 'YWAVE2' ||
    state.crazyWave === 'XYWAVE' ||
    state.crazyWave === 'XYWAVE2'
  );
}

/** Places one note's head (or a long note's tail) on the grid. Identity without HIDDEN, CHANGE-HS or a Y wave. */
export function placeTUIChartNote(
  state: ChartOptionState | undefined,
  input: { distance: number; windowBeats: number; channel: string; beat: number; seconds: number; combo?: number },
): TUIChartNotePlacement {
  if (state === undefined || !movesGridNotes(state) || !(input.windowBeats > 0))
    return { distance: input.distance, visible: true };
  const note = {
    channel: input.channel,
    beat: input.beat,
    seconds: input.seconds,
    ...(input.combo !== undefined ? { combo: input.combo } : {}),
  };
  // A note past the line (a held long note's head) reads as on the line.
  if (!Number.isFinite(input.distance))
    return {
      distance: input.distance,
      visible: resolveChartNoteVisual(state, { ...note, progress: 0 }).alpha >= TUI_CHART_HIDDEN_VISIBLE_ALPHA,
    };
  const visual = resolveChartNoteVisual(state, { ...note, progress: input.distance / input.windowBeats });
  return {
    distance: visual.progress * input.windowBeats,
    visible: visual.alpha >= TUI_CHART_HIDDEN_VISIBLE_ALPHA,
  };
}

/**
 * The grid's rows under REVERSE: row `row` of `rowCount` (0 at the top, the judge row at the bottom) moves to the
 * mirrored row, so notes rise from the bottom to a judge row at the top. Identity otherwise.
 */
export function resolveTUIReversedRow(row: number, rowCount: number, reverse: boolean): number {
  return reverse ? rowCount - 1 - row : row;
}
