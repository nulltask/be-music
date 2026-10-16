/**
 * What the select screen's browsing leaves to its session, per skin family. The browse model of
 * `@be-music/scene-model` (`reduceBrowse`, `browseEntries`, `restoreBrowse`) decides how the list is built and how the
 * cursor moves; where the families differ on what the screen does around it, the session asks its policy:
 *
 * - **Back out at the root.** LR2 does nothing when Escape is pressed with no folder open; beatoraja plays its cancel
 *   cue and leaves the screen.
 * - **A library with one chart folder.** The built-in and LR2 screens open it, as there is nothing else to pick;
 *   beatoraja shows the root.
 * - **The sort and the filters.** LR2 keeps them in the play options (its option panel), so a browse position restored
 *   after a play keeps the ones in force; beatoraja's MODE and SORT buttons are part of the browse position.
 */

import {
  createBrowseState,
  libraryRootFolders,
  restoreBrowse,
  type BrowseListOptions,
  type BrowseRestore,
  type BrowseSnapshot,
  type BrowseState,
  type Library,
} from '@be-music/scene-model';
import type { SceneFamily } from '../../host/family-kit.ts';

/** How a skin family's select screen treats what the browse model leaves open. See the module comment. */
export interface SelectPolicy {
  /** A back-out with no folder open: stay on the screen without a sound (LR2), or leave it with the cancel cue. */
  readonly atRoot: 'stay' | 'exit';
  /**
   * Open the library's one chart folder (course folders aside) when the screen has no browse position to restore, so
   * the charts show at once.
   */
  readonly openSingleFolder: boolean;
  /**
   * Where the sort and the filters live: the play options (LR2's option panel), which a restored browse position
   * keeps, or the browse position itself (beatoraja's MODE and SORT buttons), which a restore brings back.
   */
  readonly listOptions: 'play-options' | 'browse';
}

const LR2_SELECT_POLICY: SelectPolicy = { atRoot: 'stay', openSingleFolder: true, listOptions: 'play-options' };

/** Each skin family's select policy: the built-in screens follow LR2. */
export const SELECT_POLICIES: Readonly<Record<SceneFamily, SelectPolicy>> = {
  'built-in': LR2_SELECT_POLICY,
  lr2: LR2_SELECT_POLICY,
  beatoraja: { atRoot: 'exit', openSingleFolder: false, listOptions: 'browse' },
};

/**
 * The browse state a select screen opens `library` on when it has no position to restore: at the top of the root list
 * with the search and list options given, or inside the library's one chart folder when the policy opens it.
 */
export function openLibrary(
  library: Library,
  policy: SelectPolicy,
  init: { readonly searchText?: string; readonly list?: Partial<BrowseListOptions> } = {},
): BrowseState {
  const state = createBrowseState(init);
  if (!policy.openSingleFolder) return state;
  const roots = libraryRootFolders(library);
  const chartFolders = roots.filter((folder) => folder.courses === undefined);
  if (chartFolders.length !== 1) return state;
  const folder = chartFolders[0]!;
  return { ...state, path: [folder], cursors: [roots.indexOf(folder), 0] };
}

/**
 * Takes a saved browse position back over `library` (`restoreBrowse`). What the snapshot does not say is taken from
 * `current`, the state in force: the search and the favourites, and the list options. Under a policy that keeps the
 * list options in the play options, those in force win over the snapshot's.
 */
export function restoreSelectBrowse(
  library: Library,
  snapshot: BrowseSnapshot,
  current: BrowseState,
  policy: SelectPolicy,
): BrowseRestore {
  const list = policy.listOptions === 'play-options' ? current.list : (snapshot.list ?? current.list);
  return restoreBrowse(library, {
    searchText: current.searchText,
    favorites: current.favorites,
    ...snapshot,
    list,
  });
}
