import { resolveChartMainBPM, type MainBPMChart, type TimingResolver } from '@be-music/chart';

/**
 * The lowest, highest, and main BPM of a play: the built-in HUD shows them, and HS-FIX `AVERAGE` and the play log's
 * visible time read the main one, on every family's play screen. Not the select screen's `ChartBPMRange`
 * (`chart/bpm-range.ts`), which counts the header `#BPM` too, as beatoraja's `getMinBPM` / `getMaxBPM` do.
 */
export interface PlayTempoRange {
  minBPM: number;
  maxBPM: number;
  mainBPM: number;
}

/** What {@link resolvePlayTempoRange} reads of the play's resolved chart (`ResolvedChart`). */
export interface PlayTempoChart extends MainBPMChart {
  readonly timing: Pick<TimingResolver, 'bpmAtBeat' | 'tempoPoints'>;
}

/**
 * Works out a play's BPM range from its resolved chart. `minBPM` and `maxBPM` are the lowest and highest BPM of the
 * tempo map; `mainBPM` is the chart's main BPM, the BPM the most judged notes sit at (`resolveChartMainBPM` in
 * `@be-music/chart`, beatoraja's), else the start BPM for a chart without notes. Tempo points with a non-positive or
 * non-finite BPM are ignored. Returns `fallbackBPM` for all three when no tempo point is usable, and `undefined` when
 * there is no usable fallback either.
 */
export function resolvePlayTempoRange(chart: PlayTempoChart, fallbackBPM?: number): PlayTempoRange | undefined {
  let minBPM = Number.POSITIVE_INFINITY;
  let maxBPM = Number.NEGATIVE_INFINITY;
  let startBPM: number | undefined;
  for (const { bpm } of chart.timing.tempoPoints) {
    if (!Number.isFinite(bpm) || bpm <= 0) continue;
    startBPM ??= bpm;
    if (bpm < minBPM) minBPM = bpm;
    if (bpm > maxBPM) maxBPM = bpm;
  }
  if (startBPM === undefined) {
    if (fallbackBPM === undefined || !Number.isFinite(fallbackBPM) || fallbackBPM <= 0) return undefined;
    return { minBPM: fallbackBPM, maxBPM: fallbackBPM, mainBPM: fallbackBPM };
  }
  return { minBPM, maxBPM, mainBPM: resolveChartMainBPM(chart) ?? startBPM };
}
