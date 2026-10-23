import type { LibraryChart } from '@be-music/player-scene-model';

/**
 * The picture a preview list shows for a chart: its `#STAGEFILE` when the chart names one, otherwise its `#BANNER`.
 * An empty or missing path is skipped.
 */
export function previewArtworkPath(chart: LibraryChart): string | undefined {
  const { stageFile, banner } = chart.chart.metadata;
  const stage = stageFile?.trim();
  if (stage) return stage;
  const wide = banner?.trim();
  return wide ? wide : undefined;
}
