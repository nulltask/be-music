---
'@be-music/player-scene-model': minor
---

Add the PRACTICE range picker's helpers (#948): `resolvePracticeRangeChart` reads a resolved chart's measure starts, length and judged note times, and `binPracticeNoteDensity`, `practiceTimeToX` / `practiceXToTime`, `findPracticeMeasureAt`, `resolveShownPracticeRange`, `pickPracticeRangeHandle`, `dragPracticeRangeHandle` (snapping to measure starts while keeping a range of at least `PRACTICE_MIN_RANGE_MS`, END 0 = to the end) and `formatPracticeTime` (`m:ss.s`) draw and drag the range.
