/**
 * Barrel for the `@be-music/player-web/collection` subpath. Groups the user-facing browser-input surface:
 *
 * - Song collection store (`BrowserSongCollectionStore`, `BrowserSongCollection`, `BrowserSongEntry`, descriptors)
 * - Drop handling (`readDroppedFiles`, `splitDroppedSongAndThemeFiles`, `LoadProgress`)
 * - Browser compatibility probe (`checkBrowserCompat`, `summarizeBrowserCompat`, `BrowserCompatReport`)
 *
 * Anything else under `collection/` (the case-insensitive file-lookup helpers) stays internal to the package.
 */
export * from './collection.ts';
export * from './types.ts';

// Browser-side input helpers — same logical surface (= "getting files INTO the player from the browser"), kept
// alongside the collection store so consumers don't need to track which subpath they live under.
export * from '../browser/compat.ts';
export * from '../browser/drop.ts';
