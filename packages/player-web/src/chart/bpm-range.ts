import { resolveChart } from '@be-music/chart';
import type { BeMusicJson } from '@be-music/json';

export interface ChartBpmRange {
  readonly min: number;
  readonly max: number;
}

const bpmRangeByChart = new WeakMap<BeMusicJson, ChartBpmRange>();

/**
 * The lowest and highest BPM of a chart, as beatoraja's `BMSModel.getMinBPM` / `getMaxBPM` report them: the header
 * BPM and every tempo the resolved chart's tempo map (`ResolvedChart.timing`) plays at — channel `03` and `#BPMxx`
 * (`08`) changes and bmson `bpm_events`, with the format rules applied once (non-positive values ignored, `08` winning
 * over `03` at one position, object keys normalized). Cached per chart object, since song select asks again on every
 * cursor move.
 */
export function resolveChartBpmRange(chart: BeMusicJson): ChartBpmRange {
  const cached = bpmRangeByChart.get(chart);
  if (cached !== undefined) return cached;
  const header = chart.metadata.bpm;
  let min = header > 0 ? header : Number.POSITIVE_INFINITY;
  let max = header > 0 ? header : 0;
  for (const point of resolveChart(chart).timing.tempoPoints) {
    if (point.bpm < min) min = point.bpm;
    if (point.bpm > max) max = point.bpm;
  }
  const range: ChartBpmRange = Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
  bpmRangeByChart.set(chart, range);
  return range;
}
