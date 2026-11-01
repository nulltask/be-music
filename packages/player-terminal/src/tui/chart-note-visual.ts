/**
 * Terminal presentation of the chart-authored HIDDEN and CHANGE-HS families (#843). A character grid has no opacity or
 * sub-cell size, so a note shows while its HIDDEN opacity is at least one half, CHANGE-HS moves it along the lane, and
 * the CRAZY size / wave subfamilies are not drawn (they change nothing but the browser's sprites).
 */

import { resolveChartChangeHSProgress, resolveChartHiddenAlpha, type ChartOptionState } from '@be-music/chart-model';

export interface TUIChartNotePlacement {
  /** Approach distance after CHANGE-HS, in the grid's scroll-window units. */
  distance: number;
  /** False when HIDDEN hides the note in the grid. */
  visible: boolean;
}

/** Opacity at or above which a terminal cell still shows a note. */
export const TUI_CHART_HIDDEN_VISIBLE_ALPHA = 0.5;

/** Places one note's head (or a long note's tail) on the grid. Identity without HIDDEN / CHANGE-HS. */
export function placeTUIChartNote(
  state: ChartOptionState | undefined,
  input: { distance: number; windowBeats: number; channel: string; beat: number; seconds: number; combo?: number },
): TUIChartNotePlacement {
  if (state === undefined || (state.hidden === undefined && state.changeHS === undefined) || !(input.windowBeats > 0))
    return { distance: input.distance, visible: true };
  // A note past the line (a held long note's head) reads as on the line.
  if (!Number.isFinite(input.distance))
    return {
      distance: input.distance,
      visible: resolveChartHiddenAlpha(state.hidden, 0, input.seconds) >= TUI_CHART_HIDDEN_VISIBLE_ALPHA,
    };
  const progress = resolveChartChangeHSProgress(state.changeHS, {
    progress: input.distance / input.windowBeats,
    channel: input.channel,
    beat: input.beat,
    seconds: input.seconds,
    ...(input.combo !== undefined ? { combo: input.combo } : {}),
  });
  return {
    distance: progress * input.windowBeats,
    visible: resolveChartHiddenAlpha(state.hidden, progress, input.seconds) >= TUI_CHART_HIDDEN_VISIBLE_ALPHA,
  };
}
