---
'@be-music/player-web': minor
---

The built-in and LR2 select scenes keep where the player is in the library as the browse model of `@be-music/scene-model` keeps it: a `BrowseState`, changed by `reduceBrowse`, its list derived by `browseEntries` and its cues by `browseSystemSound`. `getNavigation()` returns a `BrowseSnapshot` (`captureBrowse`: the open folders by label, the cursor at every depth, the bar under the cursor by its key, the search and the list options), and `setNavigation` and the `initialNavigation` option take one. What the browse model leaves to the screen (staying put on a back-out at the root, opening a library of one chart folder, keeping the sort and the filters in the play options) is the select policy of the built-in and LR2 families.

`PixiSongSelectNavigation` and `resolveSelectNavigation` are removed. For a theme scene built on `CoreSongSelectView`, the protected `selectedIndex` is read-only, and `activateEntry`, `enterFolder` and `snapCursorAfterFilterChange` are replaced by `moveCursor(delta)` and `activateFocused()`.

Migration:

- `PixiSongSelectNavigation` → `BrowseSnapshot` from `@be-music/scene-model`. A saved `{ folderPath, selectedIndex }` converts with `browseSnapshotFromSelectNavigation`.
- `resolveSelectNavigation(collection, navigation)` → `restoreBrowse(collection, snapshot)` from `@be-music/scene-model`: `state.path` is the folder stack and `browseCursor(state)` the cursor; `restoredDepth` says how many of the saved folders were found.
