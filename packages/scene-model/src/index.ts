/**
 * `@be-music/scene-model` — what every screen of the player shows and how it behaves, whatever skin family draws it.
 * Runtime-neutral: no renderer, no DOM, no Node; time and randomness come in as inputs.
 *
 * - Library: the charts, folders and courses a select screen lists (`LibraryChart`, `LibraryFolder`, `LibraryCourse`,
 *   `LibraryEntry`), their root folders and key modes.
 */
export * from './library/entries.ts';
export * from './library/folders.ts';
export * from './library/key-mode.ts';
