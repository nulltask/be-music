import type { Library, LibraryChart, LibraryCourse, LibraryEntry, LibraryFolder } from '../library/entries.ts';
import { libraryEntryKey } from '../library/entries.ts';
import { libraryRootFolders } from '../library/folders.ts';
import { entryMatchesListFilters } from './filter.ts';
import { DEFAULT_BROWSE_LIST_OPTIONS, sameBrowseListOptions, type BrowseListOptions } from './list-options.ts';
import { matchesSearchQuery, normalizeSearchQuery } from './search.ts';
import { sortLibraryEntries } from './sort.ts';

/**
 * The player's favourite charts, by chart id, in the two lists beatoraja keeps: `music` (beatoraja's song favourites,
 * meant for every chart of a piece of music) and `charts` (one chart). The library has no music grouping yet, so both
 * are keyed by the chart the player marked.
 */
export interface BrowseFavorites {
  readonly music: readonly string[];
  readonly charts: readonly string[];
}

/**
 * Where the player is in the library and how the list is shaped: the folders open, the cursor at each depth, the
 * search and the list options, and the favourites. Immutable: every {@link reduceBrowse} returns a new state and keeps
 * the parts that did not change, so a list derived from them ({@link browseEntries}) is reused.
 */
export interface BrowseState {
  /** The open folders, root first; empty at the root. */
  readonly path: readonly LibraryFolder[];
  /**
   * The cursor at each depth, `path.length + 1` long: `cursors[0]` is the root list's, the last one the cursor in the
   * list shown. A parent's cursor is the folder bar it was opened from, so backing out lands on it again.
   */
  readonly cursors: readonly number[];
  /** The search as typed (shown back as typed); the list filters by its {@link normalizeSearchQuery} form. */
  readonly searchText: string;
  readonly list: BrowseListOptions;
  readonly favorites: BrowseFavorites;
}

const ROOT_PATH: readonly LibraryFolder[] = [];
const ROOT_CURSORS: readonly number[] = [0];
const NO_FAVORITES: BrowseFavorites = { music: [], charts: [] };

/** A browse state at the top of the root list, with the given search, list options and favourites. */
export function createBrowseState(
  init: {
    searchText?: string;
    list?: Partial<BrowseListOptions>;
    favorites?: Partial<BrowseFavorites>;
  } = {},
): BrowseState {
  return {
    path: ROOT_PATH,
    cursors: ROOT_CURSORS,
    searchText: init.searchText ?? '',
    list: init.list === undefined ? DEFAULT_BROWSE_LIST_OPTIONS : { ...DEFAULT_BROWSE_LIST_OPTIONS, ...init.list },
    favorites:
      init.favorites === undefined
        ? NO_FAVORITES
        : { music: [...(init.favorites.music ?? [])], charts: [...(init.favorites.charts ?? [])] },
  };
}

/** The cursor in the list shown. */
export function browseCursor(state: BrowseState): number {
  return state.cursors[state.cursors.length - 1] ?? 0;
}

/** The folder whose bars are shown, or `undefined` at the root. */
export function browseFolder(state: BrowseState): LibraryFolder | undefined {
  return state.path[state.path.length - 1];
}

interface EntriesMemo {
  songs: Library['songs'];
  courseFolders: Library['courseFolders'];
  query: string;
  list: BrowseListOptions;
  entries: readonly LibraryEntry[];
}

/** The last list derived per open path (the root's is shared by every state at the root). */
const ENTRIES_MEMO = new WeakMap<readonly LibraryFolder[], EntriesMemo>();

/**
 * The bars of the list shown, as {@link listEntriesAt} derives them for the state's path, search and list options. Kept
 * per path while the library, the search and the list options stay the same, so a select screen can read it every frame.
 */
export function browseEntries(library: Library, state: BrowseState): readonly LibraryEntry[] {
  const query = normalizeSearchQuery(state.searchText);
  const memo = ENTRIES_MEMO.get(state.path);
  if (
    memo !== undefined &&
    memo.songs === library.songs &&
    memo.courseFolders === library.courseFolders &&
    memo.query === query &&
    (memo.list === state.list || sameBrowseListOptions(memo.list, state.list))
  ) {
    return memo.entries;
  }
  const entries = listEntriesAt(library, state.path, query, state.list);
  ENTRIES_MEMO.set(state.path, {
    songs: library.songs,
    courseFolders: library.courseFolders,
    query,
    list: state.list,
    entries,
  });
  return entries;
}

/**
 * The bars listed with `path` open, for a lower-cased search `query` and the list options:
 *
 * - At the root, the folder bars (chart folders, then course folders); while searching, every chart of the library
 *   instead, so typing a title rewrites the list at once.
 * - Inside a chart folder its charts, inside a course folder its courses.
 * - Then the filters ({@link entryMatchesListFilters}), the search ({@link matchesSearchQuery}) at every depth, and the
 *   sort ({@link sortLibraryEntries}).
 */
export function listEntriesAt(
  library: Library,
  path: readonly LibraryFolder[],
  query: string,
  list: BrowseListOptions,
): readonly LibraryEntry[] {
  const top = path[path.length - 1];
  const base: LibraryEntry[] = top
    ? top.courses !== undefined
      ? top.courses.map((course): LibraryEntry => ({ kind: 'course', course }))
      : top.songs.map((song): LibraryEntry => ({ kind: 'song', song }))
    : query.length > 0
      ? library.songs.map((song): LibraryEntry => ({ kind: 'song', song }))
      : libraryRootFolders(library).map((folder): LibraryEntry => ({ kind: 'folder', folder }));
  let entries = base;
  if (list.keysFilter !== 'ALL' || list.difficultyFilter !== 'ALL') {
    entries = entries.filter((entry) => entryMatchesListFilters(entry, list));
  }
  if (query.length > 0) {
    entries = entries.filter((entry) => matchesSearchQuery(entry, query));
  }
  return list.sort === 'OFF' ? entries : sortLibraryEntries(entries, list.sort);
}

/** The bar under the cursor, or `undefined` when the list is empty. */
export function focusedEntry(library: Library, state: BrowseState): LibraryEntry | undefined {
  return browseEntries(library, state)[browseCursor(state)];
}

/** The chart under the cursor; `undefined` on a folder or course bar, as beatoraja reads no chart there. */
export function focusedChart(library: Library, state: BrowseState): LibraryChart | undefined {
  const entry = focusedEntry(library, state);
  return entry?.kind === 'song' ? entry.song : undefined;
}

/** The course under the cursor, or `undefined` on any other bar. */
export function focusedCourse(library: Library, state: BrowseState): LibraryCourse | undefined {
  const entry = focusedEntry(library, state);
  return entry?.kind === 'course' ? entry.course : undefined;
}

/** Whether the player marked `chartId` as a favourite in `list`. */
export function isFavorite(state: BrowseState, chartId: string, list: keyof BrowseFavorites = 'charts'): boolean {
  return state.favorites[list].includes(chartId);
}

/**
 * Maps a raw `(new - old)` cursor delta to the shortest visible step around a list of `count` bars, so a wrap-around
 * move (the first bar ↑ to the last) animates as one step back rather than a slide across the whole list. A move that
 * already fits in half the list keeps its direction, so on a list of two or three bars a step down always slides down.
 *
 * With 10 bars: +1 → +1, -1 → -1, +9 → -1, -9 → +1.
 */
export function wrappedCursorDelta(rawDelta: number, count: number): number {
  if (count <= 0) return 0;
  const half = count / 2;
  if (Math.abs(rawDelta) <= half) {
    return rawDelta;
  }
  return ((((rawDelta + half) % count) + count) % count) - half;
}

/** What the player asked of the list. */
export type BrowseCommand =
  /** Move the cursor `delta` bars, wrapping past either end (the bar list is a ring, as in LR2 and beatoraja). */
  | { type: 'move'; delta: number }
  /** Put the cursor on bar `index`, clamped to the list (Home / End, a click on a bar). */
  | { type: 'jump'; index: number }
  /**
   * Put the cursor on a random bar other than the focused one (beatoraja's random select). `value` is the random draw,
   * in [0, 1): the model draws no random number itself.
   */
  | { type: 'random'; value: number }
  /** Open the focused folder bar. */
  | { type: 'open' }
  /** Back out of the folder shown. */
  | { type: 'close' }
  /** Search for `text`; the cursor goes to the top when the query changes. */
  | { type: 'search'; text: string }
  /** Change the list options; the cursor stays on the focused bar while it is still listed. */
  | { type: 'list'; options: Partial<BrowseListOptions> }
  /** Mark or unmark the focused chart as a favourite. */
  | { type: 'favorite'; list: keyof BrowseFavorites };

/** What a {@link BrowseCommand} did, for the screen's sounds and animations. */
export type BrowseEvent =
  /** Nothing changed. */
  | { kind: 'none' }
  /**
   * The cursor moved from bar `from` to bar `to`. `delta` is how far to animate, in bars: the step asked for on a move
   * (so a wrap still slides the way the key points), else the shortest step ({@link wrappedCursorDelta}).
   */
  | { kind: 'cursor'; from: number; to: number; delta: number }
  | { kind: 'folder-opened'; folder: LibraryFolder }
  | { kind: 'folder-closed'; folder: LibraryFolder }
  /** A close at the root: there is no folder to back out of, so the screen may leave instead. */
  | { kind: 'at-root' }
  /** The search or the list options changed the list. */
  | { kind: 'list-changed' }
  | { kind: 'favorite'; chartId: string; list: keyof BrowseFavorites; favorite: boolean };

/** A {@link reduceBrowse} result: the new state and what happened. */
export interface BrowseTransition {
  readonly state: BrowseState;
  readonly event: BrowseEvent;
}

const UNCHANGED: BrowseEvent = { kind: 'none' };

/**
 * Applies one command to the browse state. Pure: the same library, state and command give the same result, and the
 * state given is never changed.
 */
export function reduceBrowse(library: Library, state: BrowseState, command: BrowseCommand): BrowseTransition {
  switch (command.type) {
    case 'move':
      return moveCursor(library, state, command.delta);
    case 'jump': {
      const count = browseEntries(library, state).length;
      if (count === 0) return { state, event: UNCHANGED };
      return setCursor(state, clampIndex(command.index, count), count);
    }
    case 'random': {
      const count = browseEntries(library, state).length;
      if (count <= 1) return { state, event: UNCHANGED };
      const current = browseCursor(state);
      let next = Math.min(count - 1, Math.max(0, Math.floor(command.value * count)));
      if (next === current) next = (next + 1) % count;
      return setCursor(state, next, count);
    }
    case 'open':
      return openFolder(library, state);
    case 'close':
      return closeFolder(library, state);
    case 'search':
      return search(library, state, command.text);
    case 'list':
      return changeList(library, state, command.options);
    case 'favorite':
      return toggleFavorite(library, state, command.list);
  }
}

function withCursor(state: BrowseState, cursor: number): BrowseState {
  const cursors = [...state.cursors];
  cursors[cursors.length - 1] = cursor;
  return { ...state, cursors };
}

function moveCursor(library: Library, state: BrowseState, delta: number): BrowseTransition {
  const count = browseEntries(library, state).length;
  const from = browseCursor(state);
  if (count === 0 || !Number.isFinite(delta)) return { state, event: UNCHANGED };
  const steps = Math.trunc(delta);
  const to = (((from + steps) % count) + count) % count;
  if (to === from) return { state, event: UNCHANGED };
  return { state: withCursor(state, to), event: { kind: 'cursor', from, to, delta: steps } };
}

function setCursor(state: BrowseState, to: number, count: number): BrowseTransition {
  const from = browseCursor(state);
  if (to === from) return { state, event: UNCHANGED };
  return {
    state: withCursor(state, to),
    event: { kind: 'cursor', from, to, delta: wrappedCursorDelta(to - from, count) },
  };
}

function openFolder(library: Library, state: BrowseState): BrowseTransition {
  const entry = focusedEntry(library, state);
  if (entry?.kind !== 'folder') return { state, event: UNCHANGED };
  return {
    state: { ...state, path: [...state.path, entry.folder], cursors: [...state.cursors, 0] },
    event: { kind: 'folder-opened', folder: entry.folder },
  };
}

function closeFolder(library: Library, state: BrowseState): BrowseTransition {
  const folder = browseFolder(state);
  if (folder === undefined) return { state, event: { kind: 'at-root' } };
  const path = state.path.length === 1 ? ROOT_PATH : state.path.slice(0, -1);
  const parent: BrowseState = { ...state, path, cursors: state.cursors.slice(0, -1) };
  // The parent list may have changed while the folder was open (a search typed inside it): keep the cursor on it.
  const count = browseEntries(library, parent).length;
  const cursor = clampIndex(browseCursor(parent), count);
  return {
    state: cursor === browseCursor(parent) ? parent : withCursor(parent, cursor),
    event: { kind: 'folder-closed', folder },
  };
}

function search(library: Library, state: BrowseState, text: string): BrowseTransition {
  if (text === state.searchText) return { state, event: UNCHANGED };
  const queryChanged = normalizeSearchQuery(text) !== normalizeSearchQuery(state.searchText);
  const next: BrowseState = { ...state, searchText: text };
  if (!queryChanged) return { state: next, event: UNCHANGED };
  // The bar under the cursor may no longer be listed, and the one at its index is unrelated: start from the top.
  return { state: browseCursor(next) === 0 ? next : withCursor(next, 0), event: { kind: 'list-changed' } };
}

function changeList(library: Library, state: BrowseState, options: Partial<BrowseListOptions>): BrowseTransition {
  const list: BrowseListOptions = { ...state.list, ...options };
  if (sameBrowseListOptions(list, state.list)) return { state, event: UNCHANGED };
  const focused = focusedEntry(library, state);
  const next: BrowseState = { ...state, list };
  const entries = browseEntries(library, next);
  // Keep the player on the bar they were on when it is still listed; else on the same row, clamped to the new list.
  const key = focused === undefined ? undefined : libraryEntryKey(focused);
  const kept = key === undefined ? -1 : entries.findIndex((entry) => libraryEntryKey(entry) === key);
  const cursor = kept >= 0 ? kept : clampIndex(browseCursor(state), entries.length);
  return { state: cursor === browseCursor(next) ? next : withCursor(next, cursor), event: { kind: 'list-changed' } };
}

function toggleFavorite(library: Library, state: BrowseState, list: keyof BrowseFavorites): BrowseTransition {
  const chart = focusedChart(library, state);
  if (chart === undefined) return { state, event: UNCHANGED };
  const ids = state.favorites[list];
  const favorite = !ids.includes(chart.id);
  const nextIds = favorite ? [...ids, chart.id] : ids.filter((id) => id !== chart.id);
  return {
    state: { ...state, favorites: { ...state.favorites, [list]: nextIds } },
    event: { kind: 'favorite', chartId: chart.id, list, favorite },
  };
}

/** `value` truncated and clamped to a list of `length` bars (0 for an empty list or a non-finite value). */
export function clampIndex(value: number, length: number): number {
  if (length <= 0 || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(length - 1, Math.trunc(value)));
}
