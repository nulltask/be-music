/**
 * `@be-music/scene-model` — what every screen of the player shows and how it behaves, whatever skin family draws it.
 * Runtime-neutral: no renderer, no DOM, no Node; time and randomness come in as inputs.
 *
 * - Library: the charts, folders and courses a select screen lists (`LibraryChart`, `LibraryFolder`, `LibraryCourse`,
 *   `LibraryEntry`), their root folders and key modes.
 * - Browse: the folder stack, cursor, search, sort, filters and favourites of the select screen as one immutable state
 *   (`BrowseState`, `reduceBrowse`), the list derived from it (`browseEntries`) and its snapshot (`captureBrowse`,
 *   `restoreBrowse`).
 * - Play options: what the player picks before a play (`PlayOptions`), its defaults, choices and validation, and the
 *   hi-speed range.
 */
export * from './library/entries.ts';
export * from './library/folders.ts';
export * from './library/key-mode.ts';

export * from './browse/list-options.ts';
export * from './browse/filter.ts';
export * from './browse/search.ts';
export * from './browse/sort.ts';
export * from './browse/state.ts';
export * from './browse/snapshot.ts';

export * from './play-options/options.ts';
export * from './play-options/choices.ts';
export * from './play-options/hi-speed.ts';
