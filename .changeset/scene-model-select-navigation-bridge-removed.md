---
'@be-music/scene-model': minor
---

`browseSnapshotFromSelectNavigation` and its `SelectSceneNavigation` type are removed. They converted the `{ folderPath, selectedIndex }` the old built-in and LR2 select scenes kept into a `BrowseSnapshot`; every select screen keeps a `BrowseSnapshot` itself now, so nothing uses them.

Migration:

- `browseSnapshotFromSelectNavigation({ folderPath, selectedIndex })` → the snapshot as a literal, `{ folderPath, cursors: [...folderPath.map(() => 0), selectedIndex] }`: `restoreBrowse` finds the parent cursors by the folders' labels.
