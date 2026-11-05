/**
 * LR2's difficulty change on the select screen (SELECT, → on a chart, and That-Which-Must-Not-Be-Named PC's 1): the
 * cursor steps to the next chart of the same track, the charts that sit in the same directory of the same source, as a
 * BMS track keeps its charts together. They are taken in the list's order, which the sort decides, wrapping around.
 */

import type { LibraryChart, LibraryEntry } from '@be-music/player-scene-model';

/** Whether two charts are of one track: the same source, and the same directory inside it. */
export function isSameTrack(left: LibraryChart, right: LibraryChart): boolean {
  return left.sourceId === right.sourceId && chartDirectory(left.chartPath) === chartDirectory(right.chartPath);
}

function chartDirectory(chartPath: string): string {
  const slash = chartPath.replaceAll('\\', '/').lastIndexOf('/');
  return slash < 0 ? '' : chartPath.slice(0, slash);
}

/**
 * The index of the bar the difficulty change moves the cursor to from `cursor`: the next chart of the focused chart's
 * track in `entries` (the previous with `step` -1), wrapping around, or `undefined` when the focused bar is not a chart
 * or its track has no other chart in the list.
 */
export function nextDifficultyIndex(
  entries: readonly LibraryEntry[],
  cursor: number,
  step: 1 | -1 = 1,
): number | undefined {
  const focused = entries[cursor];
  if (focused?.kind !== 'chart') return undefined;
  for (let offset = 1; offset < entries.length; offset += 1) {
    const index = (((cursor + step * offset) % entries.length) + entries.length) % entries.length;
    const entry = entries[index];
    if (entry?.kind === 'chart' && isSameTrack(entry.chart, focused.chart)) return index;
  }
  return undefined;
}
