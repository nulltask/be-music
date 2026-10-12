---
'@be-music/player': minor
---

The engine now plays from the resolved chart (`resolveChart` in `@be-music/chart`): its tempo map, sample triggers, SCROLL / SPEED keyframes, `#EXRANKxx` changes and judge-rank / TOTAL facts all come from that one value instead of being re-derived from the chart in several places. Add `preparePlaybackChart(resolved, options)`, which prepares a play from a `ResolvedChart`; `preparePlaybackChartData` stays as the shorthand that resolves the chart first, and `PreparedPlaybackChartData` now carries the `resolvedChart` it was prepared from. `extractTimedNotes` and the other note extractors return the resolved chart's notes as fresh play notes.
