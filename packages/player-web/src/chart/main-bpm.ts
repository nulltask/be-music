import { resolveChart, resolveChartMainBpm } from '@be-music/chart';
import type { BeMusicJson } from '@be-music/json';

const mainBpmByChart = new WeakMap<BeMusicJson, number | null>();

/**
 * A chart's main BPM for a screen that shows it before the play (beatoraja's select and decide screens, number 92): the
 * BPM the most judged notes sit at, by the rule the play takes its main BPM by (`resolveChartMainBpm`), on the chart
 * resolved as the play resolves it (`5x` / `6x` long notes without `#LNTYPE` read as `#LNTYPE 1`; `chartPath` names a
 * `.pms` chart's 9 KEY). `undefined` for a chart without notes or one that does not resolve, so a per-frame read never
 * throws. Cached per chart object, since song select asks again on every frame.
 */
export function resolveShownChartMainBpm(chart: BeMusicJson, chartPath?: string): number | undefined {
  const cached = mainBpmByChart.get(chart);
  if (cached !== undefined) return cached ?? undefined;
  let mainBpm: number | undefined;
  try {
    mainBpm = resolveChartMainBpm(
      resolveChart(chart, { inferBmsLnTypeWhenMissing: true, ...(chartPath !== undefined ? { chartPath } : {}) }),
    );
  } catch {
    mainBpm = undefined;
  }
  mainBpmByChart.set(chart, mainBpm ?? null);
  return mainBpm;
}
