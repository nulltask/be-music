import type { Library, LibraryFolder } from '../library/entries.ts';
import { libraryEntryKey } from '../library/entries.ts';
import { libraryRootFolders } from '../library/folders.ts';
import type { BrowseListOptions } from './list-options.ts';
import {
  browseCursor,
  browseEntries,
  clampIndex,
  createBrowseState,
  focusedEntry,
  type BrowseFavorites,
  type BrowseState,
} from './state.ts';

/**
 * A browse state as plain data, to keep across the scenes a play goes through (select → decide → play → result →
 * select) and across library rebuilds: folders by label rather than by object, the cursor at every depth, and the bar
 * under the cursor by its key. JSON-safe.
 */
export interface BrowseSnapshot {
  /** Labels of the open folders, root first. */
  readonly folderPath: readonly string[];
  /** The cursor at each depth, root first: `folderPath.length + 1` long, the last one the cursor in the list shown. */
  readonly cursors: readonly number[];
  /**
   * The key of the bar under the cursor (`libraryEntryKey`). A restore puts the cursor back on that bar when it is still
   * listed, wherever the list moved it, before falling back to the saved cursor.
   */
  readonly focusKey?: string;
  readonly searchText?: string;
  readonly list?: Partial<BrowseListOptions>;
  readonly favorites?: Partial<BrowseFavorites>;
}

/** The snapshot of `state` over `library` ({@link restoreBrowse} takes it back). */
export function captureBrowse(library: Library, state: BrowseState): BrowseSnapshot {
  const focused = focusedEntry(library, state);
  return {
    folderPath: state.path.map((folder) => folder.label),
    cursors: [...state.cursors],
    ...(focused !== undefined ? { focusKey: libraryEntryKey(focused) } : {}),
    searchText: state.searchText,
    list: { ...state.list },
    favorites: { music: [...state.favorites.music], charts: [...state.favorites.charts] },
  };
}

/** A {@link restoreBrowse} result: the state and how many of the saved folders were found again. */
export interface BrowseRestore {
  readonly state: BrowseState;
  /** How many labels of `folderPath` matched a folder, from the root: all of them for a full restore. */
  readonly restoredDepth: number;
}

/**
 * Takes a snapshot back over `library`, which may have been rebuilt since (another drop, a NONSTOP run's stitched
 * chart): the search, list options and favourites as saved, then the folder path walked by label as far as it matches
 * (chart folders, then course folders, at the root; a folder lists no folder of its own). Each parent cursor is put on
 * the bar of the folder opened from it, so backing out lands there. The cursor in the list shown goes to the saved bar
 * ({@link BrowseSnapshot.focusKey}) when it is still listed, else to the saved index clamped to the list. When the walk
 * stops early, the cursor is the one saved for the depth it stopped at, clamped: near where the player was.
 */
export function restoreBrowse(library: Library, snapshot: BrowseSnapshot): BrowseRestore {
  let state = createBrowseState({
    ...(snapshot.searchText !== undefined ? { searchText: snapshot.searchText } : {}),
    ...(snapshot.list !== undefined ? { list: snapshot.list } : {}),
    ...(snapshot.favorites !== undefined ? { favorites: snapshot.favorites } : {}),
  });
  let folders: readonly LibraryFolder[] = libraryRootFolders(library);
  for (const label of snapshot.folderPath) {
    const folder = folders.find((candidate) => candidate.label === label);
    if (folder === undefined) break;
    const index = browseEntries(library, state).findIndex(
      (entry) => entry.kind === 'folder' && entry.folder.label === label,
    );
    const cursors = [...state.cursors];
    cursors[cursors.length - 1] = Math.max(0, index);
    state = { ...state, path: [...state.path, folder], cursors: [...cursors, 0] };
    // Inside a folder the bars are charts or courses: no folder to walk into.
    folders = [];
  }
  const restoredDepth = state.path.length;
  const entries = browseEntries(library, state);
  const full = restoredDepth === snapshot.folderPath.length;
  const kept =
    full && snapshot.focusKey !== undefined
      ? entries.findIndex((entry) => libraryEntryKey(entry) === snapshot.focusKey)
      : -1;
  const cursor = kept >= 0 ? kept : clampIndex(snapshot.cursors[restoredDepth] ?? 0, entries.length);
  if (cursor !== browseCursor(state)) {
    const cursors = [...state.cursors];
    cursors[cursors.length - 1] = cursor;
    state = { ...state, cursors };
  }
  return { state, restoredDepth };
}

/** The browse position the built-in and LR2 select scenes keep across a play (`PixiSongSelectNavigation`). */
export interface SelectSceneNavigation {
  readonly folderPath: readonly string[];
  readonly selectedIndex: number;
}

/**
 * A built-in / LR2 select scene's navigation as a browse snapshot. It keeps no parent cursors (a restore finds them by
 * label) and no list options: those scenes keep the sort and filters in the play options.
 */
export function browseSnapshotFromSelectNavigation(navigation: SelectSceneNavigation): BrowseSnapshot {
  return {
    folderPath: [...navigation.folderPath],
    cursors: [...navigation.folderPath.map(() => 0), navigation.selectedIndex],
  };
}

/** The state the beatoraja select scene keeps across a play (`PixiBeatorajaSelectSceneSnapshot`). */
export interface BeatorajaSelectSceneSnapshot {
  readonly folderPath: readonly string[];
  readonly cursorStack: readonly number[];
  /** The MODE button's index: ALL, 5, 7, 10, 14, 9, 24 keys, 24 keys double. */
  readonly keymodeFilter: number;
  /** The SORT button's index: default, title, artist, genre, level, BPM, notes, last play. */
  readonly sortMode: number;
  readonly favoriteSongs: readonly string[];
  readonly favoriteCharts: readonly string[];
  readonly searchQuery?: string;
}

const BEATORAJA_KEYS_FILTERS = [
  'ALL',
  'KEYS_5',
  'KEYS_7',
  'KEYS_10',
  'KEYS_14',
  'KEYS_9',
  'KEYS_24',
  'KEYS_48',
] as const satisfies readonly BrowseListOptions['keysFilter'][];

const BEATORAJA_SORTS = [
  'OFF',
  'TITLE',
  'ARTIST',
  'GENRE',
  'LEVEL',
  'BPM',
  'NOTES',
  'LASTPLAY',
] as const satisfies readonly BrowseListOptions['sort'][];

/**
 * A beatoraja select scene's snapshot as a browse snapshot: its MODE and SORT indices as list options, its favourites,
 * and its search. Its LN mode override is a play setting, not part of browsing, and is dropped.
 */
export function browseSnapshotFromBeatorajaSelect(snapshot: BeatorajaSelectSceneSnapshot): BrowseSnapshot {
  return {
    folderPath: [...snapshot.folderPath],
    cursors: [...snapshot.cursorStack],
    searchText: snapshot.searchQuery ?? '',
    list: {
      keysFilter: BEATORAJA_KEYS_FILTERS[snapshot.keymodeFilter] ?? 'ALL',
      sort: BEATORAJA_SORTS[snapshot.sortMode] ?? 'OFF',
    },
    favorites: { music: [...snapshot.favoriteSongs], charts: [...snapshot.favoriteCharts] },
  };
}
