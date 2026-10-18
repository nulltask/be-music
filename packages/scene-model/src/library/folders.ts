import type { Library, LibraryChart, LibraryFolder } from './entries.ts';

/**
 * `localeCompare(…, 'ja')` as one collator: the same order, without setting up a collator for each of the thousands of
 * comparisons a large library's folder sort makes.
 */
const JAPANESE_COLLATOR = new Intl.Collator('ja');

/**
 * Groups a flat chart list into top-level folders for the select screen's root list. The grouping key is the **first
 * segment** of each chart's `directoryLabel` (relative to its source), so a chart at `LunaticCrave/SongA/song.bms`
 * lands in the `LunaticCrave` folder. Charts without a directory (a single dropped file) fall back to their source
 * label so they still appear under a sensible group.
 *
 * The folders are sorted by label in Japanese-aware locale order, matching how LR2 sorts folders alphabetically. Each
 * folder's charts keep their original order, which keeps a chart set's difficulty sequence stable inside the folder.
 */
export function groupChartsByFolder(charts: readonly LibraryChart[]): LibraryFolder[] {
  const buckets = new Map<string, LibraryChart[]>();
  for (const chart of charts) {
    const label = chartFolderLabel(chart);
    const bucket = buckets.get(label) ?? [];
    bucket.push(chart);
    buckets.set(label, bucket);
  }
  return [...buckets.entries()]
    .map(([label, entries]): LibraryFolder => ({ label, charts: entries }))
    .sort((left, right) => JAPANESE_COLLATOR.compare(left.label, right.label));
}

/** The label of the root folder `chart` is listed in ({@link groupChartsByFolder}). */
export function chartFolderLabel(chart: LibraryChart): string {
  const dir = chart.directoryLabel;
  if (!dir) {
    return chart.sourceLabel;
  }
  const slash = dir.indexOf('/');
  return slash >= 0 ? dir.slice(0, slash) : dir;
}

interface RootFoldersMemo {
  courseFolders: Library['courseFolders'];
  folders: readonly LibraryFolder[];
}

/** Root folder lists, per chart list, for the course folders they were last built with. */
const ROOT_FOLDERS = new WeakMap<readonly LibraryChart[], RootFoldersMemo>();

/**
 * The folder bars at the root of `library`: its chart folders ({@link groupChartsByFolder}), then its course folders.
 * Kept per chart list, so a select screen that reads it every frame groups the charts once per library.
 */
export function libraryRootFolders(library: Library): readonly LibraryFolder[] {
  const memo = ROOT_FOLDERS.get(library.charts);
  if (memo !== undefined && memo.courseFolders === library.courseFolders) return memo.folders;
  const folders = [...groupChartsByFolder(library.charts), ...(library.courseFolders ?? [])];
  ROOT_FOLDERS.set(library.charts, { courseFolders: library.courseFolders, folders });
  return folders;
}
