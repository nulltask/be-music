---
'@be-music/player-scene-model': minor
---

Add `resolveLibraryChartDifficulty` and `resolveLibraryChartDifficultyValue`: a library chart's own `#DIFFICULTY`, else the one estimated from its names, else from its note count, with its `basis`. The difficulty filter and course views now use it, so a chart without `#DIFFICULTY` is listed under the estimated difficulty, as beatoraja does.
