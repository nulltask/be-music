// Where `<be-music-chart-score>` draws: the lanes across a column and the bars up it, in whole CSS pixels so every
// note, long note and line lands on the pixel grid.

import type { ChartScoreBar, ChartScoreLane } from './layout.ts';

/** The sizes the score is drawn at, in CSS pixels. */
export interface ChartScoreMetrics {
  /** How tall one beat is; a 4/4 bar is four of these. */
  readonly beatHeight: number;
  readonly keyWidth: number;
  readonly scratchWidth: number;
  /** The gap between the 1P and the 2P side of a double-play chart. */
  readonly sideGap: number;
  /** The gutter left of the lanes, for the measure numbers. */
  readonly labelWidth: number;
  /** The gutter right of the lanes, for the tempo changes and stops. */
  readonly tempoWidth: number;
}

export const DEFAULT_CHART_SCORE_METRICS: ChartScoreMetrics = {
  beatHeight: 16,
  keyWidth: 10,
  scratchWidth: 16,
  sideGap: 6,
  labelWidth: 26,
  tempoWidth: 34,
};

/** One lane's place across a column. */
export interface ChartScoreLaneBox {
  readonly x: number;
  readonly width: number;
}

/** The lanes across a column: their boxes, where the lanes start and end, and the column's whole width. */
export interface ChartScoreLaneGeometry {
  readonly lanes: readonly ChartScoreLaneBox[];
  readonly left: number;
  readonly right: number;
  readonly width: number;
}

/** Lays the lanes out left to right after the label gutter, the 2P side `sideGap` apart from the 1P side. */
export function resolveChartScoreLanes(
  lanes: readonly Pick<ChartScoreLane, 'kind' | 'side'>[],
  metrics: ChartScoreMetrics = DEFAULT_CHART_SCORE_METRICS,
): ChartScoreLaneGeometry {
  const left = Math.round(metrics.labelWidth);
  let x = left;
  const boxes = lanes.map((lane, index) => {
    if (index > 0 && lane.side !== lanes[index - 1]!.side) x += Math.round(metrics.sideGap);
    const width = Math.round(lane.kind === 'key' ? metrics.keyWidth : metrics.scratchWidth);
    const box = { x, width };
    x += width;
    return box;
  });
  return { lanes: boxes, left, right: x, width: x + Math.round(metrics.tempoWidth) };
}

/** One bar's place up a column: its top and bottom (the bar line) in whole pixels, from the column's top. */
export interface ChartScoreBarBox {
  readonly index: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Stacks a column's bars bottom to top, as a printed score reads, and sizes the column to fit `columnBeats` beats (or
 * its bars, when one is longer). Each bar is as tall as its beats, rounded to whole pixels at its bar lines.
 */
export function resolveChartScoreColumn(
  bars: readonly Pick<ChartScoreBar, 'index' | 'beats'>[],
  columnBeats: number,
  beatHeight: number = DEFAULT_CHART_SCORE_METRICS.beatHeight,
): { readonly height: number; readonly bars: readonly ChartScoreBarBox[] } {
  const beats = bars.reduce((sum, bar) => sum + bar.beats, 0);
  const height = Math.round(Math.max(columnBeats, beats) * beatHeight);
  let below = 0;
  const boxes = bars.map((bar) => {
    const bottom = height - Math.round(below * beatHeight);
    below += bar.beats;
    const top = height - Math.round(below * beatHeight);
    return { index: bar.index, top, bottom };
  });
  return { height, bars: boxes };
}

/** The pixel row a place in a bar (0 at its bar line, 1 at the next) falls on. */
export function chartScoreRowAt(box: Pick<ChartScoreBarBox, 'top' | 'bottom'>, position: number): number {
  return Math.round(box.bottom - (box.bottom - box.top) * Math.min(1, Math.max(0, position)));
}
