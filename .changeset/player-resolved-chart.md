---
'@be-music/player': minor
---

The engine now plays from the resolved chart (`resolveChart` in `@be-music/chart`): its tempo map, sample triggers, SCROLL / SPEED keyframes, `#EXRANKxx` changes and judge-rank / TOTAL facts all come from that one value instead of being re-derived from the chart in several places.

- `preparePlaybackChart(resolved, options)` prepares a play from a `ResolvedChart`, and `PreparedPlaybackChartData` carries the `resolvedChart` it was prepared from. `extractTimedNotes` and the other note extractors (`@be-music/player/display`) return the resolved chart's notes as fresh play notes.
- `resolveDisplayedJudgeRankValue` and `resolveDisplayedJudgeRankLabel` (`@be-music/player/display`) also accept a `ResolvedChart` and read its judge-rank facts (`#RANK`, `#DEFEXRANK` / bmson `judge_rank`, the `#EXRANKxx` changes); a source chart is resolved first. The format defaults (bmson `judge_rank` 100, BMS NORMAL) are still filled by these helpers and by the rulesets, because play logs record only the values a chart sets.
- Fix two notes on the same lane and position being played and judged as two notes (layered bmson notes on one `x` / `y`, or two BMS object lines writing the same cell): the player keeps one note per lane and position, as beatoraja does. A long note wins over a tap; otherwise the lowest object ID (for bmson, the first sound channel) wins. The other notes are not judged, drawn or counted, but their keysounds still play as background audio. `extractTimedNotes` returns them as `shadowedNotes`, and `PreparedPlaybackChartData` carries them as `shadowedNotes`.
