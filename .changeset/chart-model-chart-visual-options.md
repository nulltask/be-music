---
'@be-music/chart-model': minor
---

Charts can now use nanasigroove's `774:HIDDEN_*`, `774:CHANGE-HS_*` and CRAZY size / wave (`SMALL`, `BIG`, `FADEIN`, `FADEOUT`, `RD-SIZE`, `XWAVE`, `XWAVE2`) options from `#OPTION` and channel `A6`; before, they were diagnosed as `unsupported-option` without effect. `compileChartOptions` emits effective-program version 2 (`CHART_OPTION_PROGRAM_VERSION`) with the new `hidden`, `changeHS`, `crazySize` and `crazyWave` state fields. The sources give no thresholds, curves or periods, so the new `resolveChartNoteVisual` and its parts (`resolveChartHiddenAlpha`, `resolveChartChangeHSProgress`, `resolveChartCrazyScale`, `resolveChartCrazyXOffset`, `parseChartVisualOption`, `isChartVisualOptionValue`, `hasChartVisualOptions`, `chartVisualHash01`) implement documented Be-Music formulas deterministically.
