---
'@be-music/chart-model': minor
---

Initial `774:GAMELEVEL_*` and `774:EXTRA_*` options are no longer diagnosed as unsupported: the new `compileChartGaugeOptions` reads them (with `parseChartGaugeOption`, `isChartGaugeOptionDeclaration` and their ID lists), and `compileChartOptions` diagnoses their A6 use as `initial-only-option`.
