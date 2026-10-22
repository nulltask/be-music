import type { LibraryChart } from '@be-music/player-scene-model';

/** A chart path as compared: `/`-separated, without a leading `./` or `/`, lowercased. */
function normalizeChartPath(path: string): string {
  return path
    .replaceAll('\\', '/')
    .replace(/^(?:\.\/|\/)+/u, '')
    .toLowerCase();
}

/**
 * The chart `?chart=` names in a track: the first whose path inside the archive is `query` or ends with `/` and `query`,
 * ignoring case and `\` / `/`, so a file name (`codebmp.bms`) or a longer path (`robita/codebmp.bms`) picks it.
 * `undefined` when none matches or the query is empty.
 */
export function findEmbedChart(charts: readonly LibraryChart[], query: string): LibraryChart | undefined {
  const wanted = normalizeChartPath(query.trim());
  if (wanted === '') return undefined;
  return charts.find((chart) => {
    const path = normalizeChartPath(chart.chartPath);
    return path === wanted || path.endsWith(`/${wanted}`);
  });
}
