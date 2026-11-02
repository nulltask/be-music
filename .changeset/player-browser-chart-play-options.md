---
'@be-music/player-browser': patch
---

A chart's gameplay options now apply in the browser, and the replay records what was played:

- `774:RANDOM_*` and `774:CRAZY_ADDMINE` replace the player's lane and mine options, including the cross-side `ALL` / `ALL+` shuffle on double-play charts.
- `774:NOTES_*`: a COPY chart is laid out, drawn and judged as 10 / 14 KEY (DP FLIP and the player's battle conversion leave it as authored), the chart's RANDOM maps onto the converted chart, a replay rebuilds the recorded conversion, and a course stage's dropped COPY is reported as a chart option diagnostic.
- The gauge display follows a chart's `GAMELEVEL` / `EXTRA` options, matching the gauge the engine runs.
