/**
 * `@be-music/player-scene-model` — what every screen of the player shows and how it behaves, whatever skin family draws it.
 * Runtime-neutral: no renderer, no DOM, no Node; time and randomness come in as inputs.
 *
 * - Library: the charts, folders and courses a select screen lists (`LibraryChart`, `LibraryFolder`, `LibraryCourse`,
 *   `LibraryEntry`), their root folders and key modes.
 * - Browse: the folder stack, cursor, search, sort, filters and favourites of the select screen as one immutable state
 *   (`BrowseState`, `reduceBrowse`), the list derived from it (`browseEntries`) and its snapshot (`captureBrowse`,
 *   `restoreBrowse`).
 * - Play options: what the player picks before a play (`PlayOptions`), its defaults, choices and validation, and the
 *   hi-speed range.
 * - Play state: the running gauge, score, graphs, combo, timed judgments, hi-speed and lane covers of a play, fed by
 *   the engine's frames and judgments (`PlayState`, `reducePlayState`), and its view in the replay's units.
 * - Play result: the one result payload for single plays, course stages, course runs and NONSTOP runs (`PlayResult`).
 * - Course view: the course a screen shows (`CourseView`) and the course-wide combo of a stage.
 * - System sounds: a theme's cues and jingles by slot (`SystemSoundSet`), from an LR2 or a beatoraja theme.
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
export * from './play-options/normal-hi-speed.ts';
export * from './play-options/judge-timing.ts';
export * from './play-options/constant-visibility.ts';

export * from './play-state/types.ts';
export * from './play-state/hi-speed.ts';
export * from './play-state/lane-cover.ts';
export * from './play-state/state.ts';
export * from './play-state/view.ts';

export * from './play-result/result.ts';
export * from './play-result/course.ts';

export * from './course-view/course-view.ts';
export * from './course-view/course-combo.ts';

export * from './system-sounds/system-sounds.ts';
