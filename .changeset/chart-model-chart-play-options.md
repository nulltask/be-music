---
'@be-music/chart-model': minor
---

Charts can now use nanasigroove's chart-authored gameplay options; before, they were diagnosed as unsupported:

- Initial `774:RANDOM_*`, the judgment-related `774:CRAZY_*` options (`GOOD2BAD`, `GREAT2BAD`, `HELLJUDGE`, `ADDMINE`) and `774:NOTES_DOUBLE` / `NOTES_COPY` / `NOTES_DBLCOPY` compile with the new `compileChartPlayOptions` into a versioned `ChartPlayOptionProgram` (`NOTES_OFF` clears `notes`, `CRAZY_OFF` does not), with `parseChartPlayOption`, `isChartPlayOptionDeclaration`, `hasChartPlayOptions`, `CHART_NOTES_OPTIONS` and the other ID lists. The legacy aliases `CRA-HYPER` and `CRA-CPDOUBLE` read as `NOTES_DOUBLE` and `NOTES_COPY`.
- Initial `774:GAMELEVEL_*` and `774:EXTRA_*` compile with the new `compileChartGaugeOptions`, with `parseChartGaugeOption`, `isChartGaugeOptionDeclaration` and their ID lists.
- `compileChartOptions` diagnoses their A6 use as `initial-only-option`.
- The fingerprint documents carry a chart's compiled gameplay options as `playOptions` (also inside `#RANDOM` branches), so charts that differ only in these options get different fingerprints; a chart without them keeps its fingerprint.
