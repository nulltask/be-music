---
'@be-music/player-scene-model': minor
---

PRACTICE's range now comes from the bars picked on the chart's score rather than from the play options: `PlayOptions` no longer has `practiceStartMs` / `practiceEndMs`, and `resolvePracticeSelection(options, ruleset, range?)` takes the range (`PracticeRange`, chart milliseconds) as its own argument, the whole chart without one. The range picker helpers (`resolvePracticeRangeChart`, `binPracticeNoteDensity`, `practiceTimeToX`, `practiceXToTime`, `findPracticeMeasureAt`, `resolveShownPracticeRange`, `pickPracticeRangeHandle`, `dragPracticeRangeHandle`) are removed; `formatPracticeTime` stays.
