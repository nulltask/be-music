---
'@be-music/player-scene-model': minor
---

Add `resolveLibraryChartDifficulty` and `resolveLibraryChartDifficultyValue`: a library chart's own `#DIFFICULTY`, else the one estimated from its names, marked `estimated`. The difficulty filter and course views now use it, so a chart without `#DIFFICULTY` is listed under the difficulty its names suggest, as beatoraja does.
