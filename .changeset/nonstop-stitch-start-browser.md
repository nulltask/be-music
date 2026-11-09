---
'@be-music/player-browser': minor
---

Speed up stitching a NONSTOP course from a large library. `createNonstopAssets` built a reverse index over every file of each stage's source to name a found file, which on a library of hundreds of thousands of files made the stitch take most of a second and froze the page; it now takes the key the lookup found the file under. A WAV's codec and folder fallbacks are collected in one pass instead of one lookup chain per fallback.

- New `resolveChartAudioAssetCandidates`: every file `resolveChartAudioAsset` can play for a path, best first, each with its key in the source.
- `resolveChartBGAAsset` also returns the `key` of the file it found.
- `createNonstopAssets` returns `prefetch()`, which looks up every WAV / BMP the stage charts declare ahead of the stitch, yielding to the page between slices, and `setStageCharts()`, which hands over the stage charts as played.
