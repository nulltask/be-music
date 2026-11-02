---
'@be-music/chart-model': minor
---

Charts can now use nanasigroove's chart-authored display options from `#OPTION` and channel `A6`; before, they were diagnosed as `unsupported-option` without effect:

- `774:HIDDEN_*` (including `M-SUDDEN`), `774:CHANGE-HS_*` and every visual CRAZY option (`SMALL`, `BIG`, `FADEIN`, `FADEOUT`, `RD-SIZE`, the X / Y / XY / 3D waves, `STAR`, `SPIN`, `CLONE`, `CLONE2`, `S-CLONE`, `LINEMOVE`, `LINEMOVE2`, `HIDJUDGE`, `DARK`, `DARK2`, `REVERSE`).
- The legacy `774:HID-*` / `774:CRA-*` IDs, in initial declarations only (`initial-only-alias` on A6), with `resolveChartLegacyOptionAlias`.
- `compileChartOptions` emits effective-program version 3 (`CHART_OPTION_PROGRAM_VERSION`) with the new `hidden`, `changeHS`, `crazySize`, `crazyWave`, `crazyColor`, `crazySpin`, `crazyClone`, `crazyLine`, `crazyJudge`, `crazyDark` and `crazyReverse` fields.
- The sources give no thresholds, curves or periods, so `resolveChartNoteVisual` (with `tint`, `rotation` and `clones`) and its parts implement documented Be-Music formulas deterministically: `resolveChartHiddenAlpha`, `resolveChartChangeHSProgress`, `resolveChartCrazyScale`, `resolveChartCrazyXOffset`, `resolveChartCrazyYProgress`, `resolveChartCrazyWaveScale`, `resolveChartCrazyTint`, `resolveChartCrazyRotation`, `resolveChartCrazyClones`, `resolveChartLineLift`, `resolveChartPlayfieldVisual`, plus `parseChartVisualOption`, `isChartVisualOptionValue`, `hasChartVisualOptions`, `hasChartPlayfieldVisual`, `chartVisualOptionFieldsOf` and `chartVisualHash01`.
