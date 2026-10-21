// Rejected prototype retained only to reproduce the benchmark.
import { resolveChart, type ChartPlayVariant, type RandomDraws } from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';
import { preparePlaybackChart, type PreparedPlaybackChartData } from '@be-music/player-engine';

export interface PreparePlaybackTaskInput {
  chart: BeMusicJSON;
  randomDraws: RandomDraws;
  playVariant: ChartPlayVariant;
  extension: string | undefined;
}
export type PreparedPlaybackTaskResult = Omit<PreparedPlaybackChartData, 'resolvedChart'>;
export function preparePlaybackTask(input: PreparePlaybackTaskInput): PreparedPlaybackTaskResult {
  const resolved = resolveChart(input.chart, {
    randomDraws: input.randomDraws,
    playVariant: input.playVariant,
    inferBmsLNTypeWhenMissing: true,
  });
  const { resolvedChart: _, ...prepared } = preparePlaybackChart(resolved, { laneModeExtension: input.extension }, 0);
  return prepared;
}
