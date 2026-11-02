---
'@be-music/chart-model': minor
---

Initial `774:NOTES_DOUBLE`, `NOTES_COPY` and `NOTES_DBLCOPY` are no longer diagnosed as unsupported: `compileChartPlayOptions` compiles them into the gameplay program's new `notes` field (`NOTES_OFF` clears it, `CRAZY_OFF` does not), with the new `CHART_NOTES_OPTIONS` list. The fingerprint documents now carry a chart's compiled gameplay options as `playOptions` (also inside `#RANDOM` branches), so charts that differ only in these options get different fingerprints; a chart without them keeps its fingerprint.
