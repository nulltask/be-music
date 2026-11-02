---
'@be-music/player-engine': minor
---

A chart's NOTES options now take effect: DOUBLE adds a partner on each key note's mirror lane, COPY plays a 5 / 7 KEY chart as 10 / 14 KEY with the 2P side its mirror image (in place of the player's battle conversion), and DBLCOPY does both. `preparePlaybackChart` takes the conversion as `chartNotes`; a course stage leaves COPY out to keep its key mode. The new `resolveEffectiveChartPlayOptions` narrows a chart's program to what takes effect, which the play records, and `resolveChartNotesPlayVariant` gives the variant it plays as. When no host prepares the chart (the terminal), the engine now applies the chart's RANDOM and ADDMINE too. Replays accept the recorded `notes`, and the new `chartProgramCopiesChart` with `RecordPlayKind.chartCopyLeftOut` keeps a course stage without the copy out of the chart's record.
