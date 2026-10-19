import { resolveChartMainBpm, type MainBpmChart, type TimingResolver } from '@be-music/chart';

/**
 * The lowest, highest, and main BPM of a play: the built-in HUD shows them, and HS-FIX `AVERAGE` and the play log's
 * visible time read the main one, on every family's play screen. Not the select screen's `ChartBpmRange`
 * (`chart/bpm-range.ts`), which counts the header `#BPM` too, as beatoraja's `getMinBPM` / `getMaxBPM` do.
 */
export interface PlayTempoRange {
  minBpm: number;
  maxBpm: number;
  mainBpm: number;
}

/** What {@link resolvePlayTempoRange} reads of the play's resolved chart (`ResolvedChart`). */
export interface PlayTempoChart extends MainBpmChart {
  readonly timing: Pick<TimingResolver, 'bpmAtBeat' | 'tempoPoints'>;
}

/**
 * Works out a play's BPM range from its resolved chart. `minBpm` and `maxBpm` are the lowest and highest BPM of the
 * tempo map; `mainBpm` is the chart's main BPM, the BPM the most judged notes sit at (`resolveChartMainBpm` in
 * `@be-music/chart`, beatoraja's), else the start BPM for a chart without notes. Tempo points with a non-positive or
 * non-finite BPM are ignored. Returns `fallbackBpm` for all three when no tempo point is usable, and `undefined` when
 * there is no usable fallback either.
 */
export function resolvePlayTempoRange(chart: PlayTempoChart, fallbackBpm?: number): PlayTempoRange | undefined {
  let minBpm = Number.POSITIVE_INFINITY;
  let maxBpm = Number.NEGATIVE_INFINITY;
  let startBpm: number | undefined;
  for (const { bpm } of chart.timing.tempoPoints) {
    if (!Number.isFinite(bpm) || bpm <= 0) continue;
    startBpm ??= bpm;
    if (bpm < minBpm) minBpm = bpm;
    if (bpm > maxBpm) maxBpm = bpm;
  }
  if (startBpm === undefined) {
    if (fallbackBpm === undefined || !Number.isFinite(fallbackBpm) || fallbackBpm <= 0) return undefined;
    return { minBpm: fallbackBpm, maxBpm: fallbackBpm, mainBpm: fallbackBpm };
  }
  return { minBpm, maxBpm, mainBpm: resolveChartMainBpm(chart) ?? startBpm };
}
