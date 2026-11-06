---
'@be-music/player-browser': minor
---

Add `createRandomMixCandidate` and `resolveRandomMixBPM` to `@be-music/player-browser/collection`, which read a library chart for a RANDOM MIX without hashing its file, and `CourseMaker.keepRandomMix`, `randomMixConditions`, `setRandomMixConditions`, `setRandomMixSettings` and `setDefaultConnection`, which keep a draw made elsewhere, the RANDOM MIX dialog's conditions, the RANDOM MIX settings and the default NONSTOP connection.

`createRandomMixCandidate` reads a chart's difficulty as the library lists it (`resolveLibraryChartDifficulty`): its own `#DIFFICULTY` as `difficulty`, an estimate from its names or note count as `estimatedDifficulty`.
