---
'@be-music/chart-model': minor
---

Initial `774:RANDOM_*` and the judgment-related `774:CRAZY_*` options (`GOOD2BAD`, `GREAT2BAD`, `HELLJUDGE`, `ADDMINE`) are no longer diagnosed as unsupported: the new `compileChartPlayOptions` compiles them into a versioned `ChartPlayOptionProgram`, with `parseChartPlayOption`, `isChartPlayOptionDeclaration`, `hasChartPlayOptions` and their ID lists. `compileChartOptions` diagnoses their A6 use as `initial-only-option`.
