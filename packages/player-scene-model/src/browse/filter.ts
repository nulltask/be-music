import type { LibraryChart, LibraryCourse, LibraryEntry } from '../library/entries.ts';
import { resolveLibraryChartKeyMode, type KeyMode } from '../library/key-mode.ts';
import type { BrowseListOptions, DifficultyFilter, KeysFilter } from './list-options.ts';

/** Each difficulty filter's `#DIFFICULTY` value (LR2's 1 BEGINNER … 5 INSANE). */
const DIFFICULTY_LEVELS: Readonly<Record<Exclude<DifficultyFilter, 'ALL'>, number>> = {
  BEGINNER: 1,
  NORMAL: 2,
  HYPER: 3,
  ANOTHER: 4,
  INSANE: 5,
};

/** Each key-mode filter's key mode. */
const FILTER_KEY_MODES: Readonly<Record<Exclude<KeysFilter, 'ALL'>, KeyMode>> = {
  KEYS_5: 5,
  KEYS_7: 7,
  KEYS_9: 9,
  KEYS_10: 10,
  KEYS_14: 14,
  KEYS_24: 24,
  KEYS_48: 48,
};

/** The key mode a key-mode filter lists, or `undefined` for `ALL`. */
export function keysFilterKeyMode(filter: KeysFilter): KeyMode | undefined {
  return filter === 'ALL' ? undefined : FILTER_KEY_MODES[filter];
}

/**
 * The key mode a RANDOM MIX draws under a key-mode filter: the filter's, and 7 under `ALL`, as LR2's
 * `CreateRandomCourse` does (OpenLR2 L8709-L8775; its SINGLE / DOUBLE filters, which be-music lacks, draw 7 and 14).
 */
export function resolveLR2RandomMixKeyMode(filter: KeysFilter): KeyMode {
  return keysFilterKeyMode(filter) ?? 7;
}

/**
 * Whether a chart is listed under a difficulty filter: every chart under `ALL`, else the charts whose `#DIFFICULTY` is
 * the filter's. A chart that names no difficulty (none, or 0) has no bucket, so a filter other than `ALL` leaves it out.
 */
export function chartMatchesDifficultyFilter(chart: LibraryChart, filter: DifficultyFilter): boolean {
  if (filter === 'ALL') return true;
  const value = chart.chart.metadata.difficulty;
  if (value === undefined || value === 0) return false;
  return value === DIFFICULTY_LEVELS[filter];
}

/** Whether a chart is listed under a key-mode filter: every chart under `ALL`, else its key mode is the filter's. */
export function chartMatchesKeysFilter(chart: LibraryChart, filter: KeysFilter): boolean {
  const keyMode = keysFilterKeyMode(filter);
  return keyMode === undefined || resolveLibraryChartKeyMode(chart) === keyMode;
}

/**
 * Whether a course bar is listed under a key-mode filter: LR2 lists only the courses of the filter's key mode (OpenLR2
 * L18030-L18053, `WHERE line=…`). A course that names no key mode (`definition.keyMode`, e.g. a beatoraja course) and a
 * NEW COURSE bar stay listed.
 */
export function courseMatchesKeysFilter(
  course: Pick<LibraryCourse, 'newCourse'> & { definition: { keyMode?: number } },
  filter: KeysFilter,
): boolean {
  const keyMode = keysFilterKeyMode(filter);
  if (keyMode === undefined) return true;
  const courseKeyMode = course.definition.keyMode;
  if (courseKeyMode === undefined || course.newCourse === true) return true;
  return courseKeyMode === keyMode;
}

/**
 * Whether a bar stays listed under the list's filters: a chart by its difficulty and key mode, a course by its key mode,
 * and a folder always (as LR2 lists every folder whatever the filters; an emptied folder can still be opened and left).
 */
export function entryMatchesListFilters(
  entry: LibraryEntry,
  options: Pick<BrowseListOptions, 'keysFilter' | 'difficultyFilter'>,
): boolean {
  switch (entry.kind) {
    case 'folder':
      return true;
    case 'chart':
      return (
        chartMatchesDifficultyFilter(entry.chart, options.difficultyFilter) &&
        chartMatchesKeysFilter(entry.chart, options.keysFilter)
      );
    case 'course':
      return courseMatchesKeysFilter(entry.course, options.keysFilter);
  }
}
