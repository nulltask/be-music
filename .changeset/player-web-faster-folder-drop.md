---
'@be-music/player-web': minor
---

Dropping a large BMS folder no longer stalls on "Collecting files…": the drop walk now lists the tree first and only opens the files needed right away (theme candidates outside chart folders, play-logs and archives), while charts, audio and BGA stay as unopened `DeferredDroppedFile` handles that open on first read. The chart parser also keeps a few chart reads in flight ahead of the chart it is parsing.

- `readDroppedFiles` now returns `BrowserDroppedFile[]` (`File | DeferredDroppedFile`), and the collection loaders and `BrowserSongAssetEntry` accept the deferred handles.
- New `materializeDroppedFiles` opens deferred handles into plain `File`s for APIs that need them, and `createEagerDropPathPredicate` exposes the open-now rule.
