---
'@be-music/player-scene-model': minor
---

Take the PRACTICE range from the bars picked, and list charts under an estimated difficulty.

- PRACTICE's range now comes from the bars picked on the chart's score rather than from the play options: `PlayOptions` no longer has `practiceStartMs` / `practiceEndMs`, and `resolvePracticeSelection(options, ruleset, range?)` takes the range (`PracticeRange`, chart milliseconds) as its own argument, the whole chart without one. The range picker helpers (`resolvePracticeRangeChart`, `binPracticeNoteDensity`, `practiceTimeToX`, `practiceXToTime`, `findPracticeMeasureAt`, `resolveShownPracticeRange`, `pickPracticeRangeHandle`, `dragPracticeRangeHandle`) are removed; `formatPracticeTime` stays.
- Add `resolveLibraryChartDifficulty` and `resolveLibraryChartDifficultyValue`: a library chart's own `#DIFFICULTY`, else the one estimated from its names, else from its note count, with its `basis`. The difficulty filter and course views now use it, so a chart without `#DIFFICULTY` is listed under the estimated difficulty, as beatoraja does.
