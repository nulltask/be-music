---
'@be-music/player-engine': minor
---

A chart's gameplay options now take effect, and the play records them in `chart.chartPlayOptions` (`PlayerOptions.chartPlayOptionProgram` replays a recorded program):

- `GOOD2BAD`, `GREAT2BAD` and `HELLJUDGE` narrow the judge windows in live play and in replay simulation.
- The new `applyChartPlayOptions` puts a chart's RANDOM and ADDMINE in place of the player's lane and mine options for a host; when no host prepares the chart (the terminal), the engine applies them itself. A chart-forced arrangement is not counted as the player's lane assist.
- NOTES: DOUBLE adds a partner on each key note's mirror lane, COPY plays a 5 / 7 KEY chart as 10 / 14 KEY with the 2P side its mirror image (in place of the player's battle conversion), and DBLCOPY does both. `preparePlaybackChart` takes the conversion as `chartNotes`; a course stage leaves COPY out to keep its key mode, and `chartProgramCopiesChart` with `RecordPlayKind.chartCopyLeftOut` keeps such a stage out of the chart's record. `resolveEffectiveChartPlayOptions` narrows a chart's program to what takes effect, and `resolveChartNotesPlayVariant` gives the variant it plays as.
- `GAMELEVEL` / `EXTRA` select the gauge of a live play in place of the player's pick (both players' in a two-player play), except in a course stage, PRACTICE and a replay. The new `resolveChartGaugeType` in `@be-music/player-engine/ruleset` maps each pair onto the ruleset's own gauges, and the replay records the gauge played.
- NONSTOP diagnoses these options per stage instead of applying them.
