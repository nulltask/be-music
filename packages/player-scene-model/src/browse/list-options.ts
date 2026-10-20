/**
 * How the bar list is ordered. LR2's sort button cycles `OFF` / `LEVEL` / `TITLE` / `CLEAR`; beatoraja's adds `ARTIST`,
 * `GENRE`, `BPM`, `NOTES` and `LASTPLAY`.
 *
 * - `OFF` — the library's order: folders by label, the charts of a folder in their source order.
 * - `TITLE` / `ARTIST` / `GENRE` — by that text, case-insensitively, in the runtime's locale order.
 * - `LEVEL` — by `#PLAYLEVEL`, lowest first, charts without one last; equal levels by title.
 * - `BPM` — by the chart's BPM, lowest first. `NOTES` — by its note count, fewest first.
 * - `CLEAR` — by clear lamp once records feed the sort; until then by title, so the button still reorders the list.
 * - `LASTPLAY` — by the last play once records feed the sort; until then the library's order.
 */
export type BrowseSort = 'OFF' | 'TITLE' | 'ARTIST' | 'GENRE' | 'LEVEL' | 'BPM' | 'NOTES' | 'CLEAR' | 'LASTPLAY';

/**
 * The key mode the bar list is narrowed to: `ALL`, or the charts played with that many keys (`KEYS_24` / `KEYS_48`:
 * the 24-key single and double modes). LR2's key filter button cycles `ALL` and the 5 / 7 / 10 / 14 / 9 key modes;
 * beatoraja's adds the 24-key ones.
 */
export type KeysFilter = 'ALL' | 'KEYS_5' | 'KEYS_7' | 'KEYS_9' | 'KEYS_10' | 'KEYS_14' | 'KEYS_24' | 'KEYS_48';

/**
 * The `#DIFFICULTY` the bar list is narrowed to: `ALL`, or the charts that name that difficulty (1 BEGINNER … 5
 * INSANE). A chart that names none is listed only under `ALL`. LR2's difficulty filter; beatoraja has none.
 */
export type DifficultyFilter = 'ALL' | 'BEGINNER' | 'NORMAL' | 'HYPER' | 'ANOTHER' | 'INSANE';

/** What shapes the bar list besides the search: its order and its filters. */
export interface BrowseListOptions {
  readonly sort: BrowseSort;
  readonly keysFilter: KeysFilter;
  readonly difficultyFilter: DifficultyFilter;
}

/** The list as the library lists it: no sort, no filter. */
export const DEFAULT_BROWSE_LIST_OPTIONS: Readonly<BrowseListOptions> = {
  sort: 'OFF',
  keysFilter: 'ALL',
  difficultyFilter: 'ALL',
};

/** Whether two list options shape the list the same way. */
export function sameBrowseListOptions(left: BrowseListOptions, right: BrowseListOptions): boolean {
  return (
    left.sort === right.sort && left.keysFilter === right.keysFilter && left.difficultyFilter === right.difficultyFilter
  );
}
