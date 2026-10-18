---
'@be-music/scene-model': minor
---

`browseSnapshotFromBeatorajaSelect` and its `BeatorajaSelectSceneSnapshot` type are removed: the beatoraja select screen keeps a `BrowseSnapshot` itself now (`@be-music/player-web`'s `createSelectScene`), so nothing has the old scene's snapshot to convert.

Migration: keep the select screen's `BrowseSnapshot` (`snapshot()`, or `captureBrowse`) instead of the beatoraja select scene's snapshot. Its `list` holds what the MODE and SORT indices did (`BEATORAJA_KEYS_FILTERS[keymodeFilter]`, `BEATORAJA_SORTS[sortMode]` of `@be-music/beatoraja-skin/scene`), `favorites` the song and chart favourites (`music`, `charts`), `searchText` the search and `cursors` the cursor stack. The LN mode override is not part of browsing.
