import {
  parseCourseChartFilter,
  selectCourseCharts,
  type CourseChartQuery,
  type CourseChartRecord,
} from '@be-music/player-engine/course';
import type { LibraryChart, LibraryEntry } from '../library/entries.ts';

/** The character a search starts with to be a chart filter expression instead of a text search. */
export const CHART_FILTER_SEARCH_PREFIX = '?';

/**
 * The form a search text filters by: trimmed and lower-cased, so `" Ignition "` and `"ignition"` list the same bars. A
 * chart filter expression (`?…`, {@link parseBrowseSearch}) is only trimmed: its string literals keep their case.
 */
export function normalizeSearchQuery(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith(CHART_FILTER_SEARCH_PREFIX) ? trimmed : trimmed.toLowerCase();
}

/**
 * What a search text asks for: nothing (an empty box), a text search on its lower-cased form
 * ({@link matchesSearchQuery}), or, for a text that starts with `?`, the chart filter expression after it — the SQL
 * `WHERE` clause beatoraja random courses use (`parseCourseChartFilter`), with an optional `ORDER BY` / `LIMIT`. An
 * expression that does not parse is `invalid`, with the reason, and filters nothing.
 */
export type BrowseSearch =
  | { readonly kind: 'none' }
  | { readonly kind: 'text'; readonly query: string }
  | { readonly kind: 'filter'; readonly query: CourseChartQuery }
  | { readonly kind: 'invalid'; readonly error: string };

const NO_SEARCH: BrowseSearch = { kind: 'none' };
let lastParsed: { text: string; search: BrowseSearch } | undefined;

/** Reads a search text ({@link BrowseSearch}). The last text's result is kept, so a screen can ask on every frame. */
export function parseBrowseSearch(text: string): BrowseSearch {
  if (lastParsed?.text === text) return lastParsed.search;
  const search = readBrowseSearch(normalizeSearchQuery(text));
  lastParsed = { text, search };
  return search;
}

function readBrowseSearch(query: string): BrowseSearch {
  if (query.length === 0) return NO_SEARCH;
  if (!query.startsWith(CHART_FILTER_SEARCH_PREFIX)) return { kind: 'text', query };
  const expression = query.slice(CHART_FILTER_SEARCH_PREFIX.length);
  // `?` alone is the start of an expression being typed: it lists nothing yet, and is no error.
  if (expression.trim().length === 0) return NO_SEARCH;
  const parsed = parseCourseChartFilter(expression);
  if (!parsed.ok) return { kind: 'invalid', error: parsed.error };
  // The list has no random source of its own (it is derived again from the same state), so it cannot shuffle.
  if (parsed.query.orderBy.some((term) => term.key.type === 'random')) {
    return { kind: 'invalid', error: 'ORDER BY RANDOM() is not supported in a search' };
  }
  return { kind: 'filter', query: parsed.query };
}

/** The error of an invalid chart filter expression in `text`, else `undefined`. */
export function browseSearchError(text: string): string | undefined {
  const search = parseBrowseSearch(text);
  return search.kind === 'invalid' ? search.error : undefined;
}

/**
 * Whether a bar matches a lower-cased search query ({@link normalizeSearchQuery}); every bar matches an empty one. A
 * chart matches when its title, subtitle, artist, genre or file label contains the query (authors put difficulty hints
 * such as `[7K HARD]` in file names), a folder on its label, a course on its name.
 */
export function matchesSearchQuery(entry: LibraryEntry, lowerQuery: string): boolean {
  if (lowerQuery.length === 0) return true;
  if (entry.kind === 'folder') {
    return entry.folder.label.toLowerCase().includes(lowerQuery);
  }
  if (entry.kind === 'course') {
    return entry.course.definition.name.toLowerCase().includes(lowerQuery);
  }
  const chart = entry.chart;
  const haystacks: Array<string | undefined> = [
    chart.title,
    chart.subtitle,
    chart.artist,
    chart.genre,
    chart.fileLabel,
  ];
  for (const value of haystacks) {
    if (typeof value === 'string' && value.toLowerCase().includes(lowerQuery)) {
      return true;
    }
  }
  return false;
}

/**
 * A chart as a chart filter sees it from its library entry alone: the title, subtitle, artist, genre, path, level and
 * note count. A host that knows more (the chart's hashes, its best record, its song information) gives
 * `Library.chartFilterRecord` instead.
 */
export function libraryChartFilterRecord(chart: LibraryChart): CourseChartRecord {
  const level =
    typeof chart.playLevel === 'number' ? chart.playLevel : Number.parseInt(String(chart.playLevel ?? ''), 10);
  return {
    title: chart.title,
    path: chart.chartPath,
    level: Number.isFinite(level) ? Math.trunc(level) : 0,
    notes: chart.totalNotes,
    ...(chart.subtitle !== undefined ? { subtitle: chart.subtitle } : {}),
    ...(chart.artist !== undefined ? { artist: chart.artist } : {}),
    ...(chart.genre !== undefined ? { genre: chart.genre } : {}),
  };
}

/**
 * The bars a chart filter expression lists: the chart bars `query` selects (`selectCourseCharts`), in its `ORDER BY`
 * order and cut by its `LIMIT`; other bars never match. `recordOf` gives each chart's filter record.
 */
export function filterEntriesByChartQuery(
  entries: readonly LibraryEntry[],
  query: CourseChartQuery,
  recordOf: (chart: LibraryChart) => CourseChartRecord,
): LibraryEntry[] {
  const charts = entries.filter((entry): entry is Extract<LibraryEntry, { kind: 'chart' }> => entry.kind === 'chart');
  return selectCourseCharts(query, charts, (entry) => recordOf(entry.chart));
}
