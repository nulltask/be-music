import {
  estimateDifficultyFromNames,
  resolveDisplayedDifficultyValue,
  type DisplayedDifficulty,
} from '@be-music/player-engine/display';
import type { LibraryChart } from './entries.ts';

/** What a library chart's difficulty is read from: the parsed chart, and its file name when the entry has one. */
export type LibraryChartDifficultySource = Pick<LibraryChart, 'chart'> &
  Partial<Pick<LibraryChart, 'fileLabel' | 'chartPath'>>;

/** The estimate of each chart, from its names (which do not change); `null` for a chart its names give none. */
const estimates = new WeakMap<LibraryChartDifficultySource, number | null>();

function estimate(chart: LibraryChartDifficultySource): number | undefined {
  let value = estimates.get(chart);
  if (value === undefined) {
    const { metadata, bmson } = chart.chart;
    value =
      estimateDifficultyFromNames({
        title: metadata.title,
        subtitle: metadata.subtitle,
        chartName: bmson.info.chartName,
        fileName: chart.fileLabel ?? chart.chartPath,
      }) ?? null;
    estimates.set(chart, value);
  }
  return value ?? undefined;
}

/**
 * The difficulty (1 BEGINNER … 5 INSANE) a library chart is listed, filtered and drawn under: its own `#DIFFICULTY`,
 * else the one its names suggest (`estimateDifficultyFromNames`), marked `estimated` so a screen can tell the two
 * apart. `undefined` when neither gives one. The chart's own value is read on every call, so an edited difficulty
 * (LR2's level edit) takes over from the estimate.
 *
 * Only what the player sees reads this: a replay, a score and a written chart keep the chart's own `#DIFFICULTY`.
 */
export function resolveLibraryChartDifficulty(chart: LibraryChartDifficultySource): DisplayedDifficulty | undefined {
  const declared = resolveDisplayedDifficultyValue(chart.chart);
  if (declared !== undefined) return { value: declared, estimated: false };
  const estimated = estimate(chart);
  return estimated !== undefined ? { value: estimated, estimated: true } : undefined;
}

/** {@link resolveLibraryChartDifficulty}'s value alone, for a consumer that draws no mark (an LR2 or beatoraja op). */
export function resolveLibraryChartDifficultyValue(chart: LibraryChartDifficultySource): number | undefined {
  return resolveLibraryChartDifficulty(chart)?.value;
}
