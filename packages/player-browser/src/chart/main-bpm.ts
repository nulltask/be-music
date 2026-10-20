import { resolveChart, resolveChartMainBPM } from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';

const mainBPMByChart = new WeakMap<BeMusicJSON, number | null>();

/**
 * A chart's main BPM for a screen that shows it before the play (beatoraja's select and decide screens, number 92): the
 * BPM the most judged notes sit at, by the rule the play takes its main BPM by (`resolveChartMainBPM`), on the chart
 * resolved as the play resolves it (`5x` / `6x` long notes without `#LNTYPE` read as `#LNTYPE 1`; `chartPath` names a
 * `.pms` chart's 9 KEY). `undefined` for a chart without notes or one that does not resolve, so a per-frame read never
 * throws. Cached per chart object, since song select asks again on every frame.
 */
export function resolveShownChartMainBPM(chart: BeMusicJSON, chartPath?: string): number | undefined {
  const cached = mainBPMByChart.get(chart);
  if (cached !== undefined) return cached ?? undefined;
  let mainBPM: number | undefined;
  try {
    mainBPM = resolveChartMainBPM(
      resolveChart(chart, { inferBmsLNTypeWhenMissing: true, ...(chartPath !== undefined ? { chartPath } : {}) }),
    );
  } catch {
    mainBPM = undefined;
  }
  mainBPMByChart.set(chart, mainBPM ?? null);
  return mainBPM;
}
