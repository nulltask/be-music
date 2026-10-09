---
'@be-music/player-web': minor
---

Dropping a large BMS folder no longer stalls on "Collecting files…": the drop walk now lists the tree first and only opens the files needed right away (theme candidates outside chart folders, play-logs and archives), while charts, audio and BGA stay as unopened `DeferredDroppedFile` handles that open on first read. The chart parser also keeps a few chart reads in flight ahead of the chart it is parsing.

Dropping a whole BMS library no longer slows to a crawl part-way through "Parsing charts…" (and eventually crashes the tab): every parsed chart kept in the collection now drops the stringifier-only `preservation` layers, stops pinning the decoded chart source, and keeps its `events` packed in typed arrays that are rebuilt on read (the most recently read charts stay unpacked). On a 5,537-chart library this takes the JS heap after loading from about 2 GB to about 0.5 GB. A 686k-file / 5,537-chart drop now finishes in about 36 s at a steady parse rate instead of stalling after ~2,500 charts.

- `readDroppedFiles` now returns `BrowserDroppedFile[]` (`File | DeferredDroppedFile`), and the collection loaders and `BrowserSongAssetEntry` accept the deferred handles.
- New `materializeDroppedFiles` opens deferred handles into plain `File`s for APIs that need them, and `createEagerDropPathPredicate` exposes the open-now rule.
