---
'@be-music/player-browser': minor
---

Add `loadChartCollectionsFromFileGroups` and `BrowserChartCollectionStore.appendFromFileGroups`, which load several groups of files as separate drops but read them all before parsing and parse every group's charts in one pass over the worker pool, so the `reading` and `parsing` progress each run once with one total instead of starting again for each group.
