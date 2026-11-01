---
'@be-music/player-engine': minor
---

A chart's `GOOD2BAD`, `GREAT2BAD` and `HELLJUDGE` options now narrow the judge windows in live play and in replay simulation, and the play records its chart-authored gameplay options in `chart.chartPlayOptions`. `PlayerOptions.chartPlayOptionProgram` replays a recorded program. The new `applyChartPlayOptions` puts a chart's RANDOM and ADDMINE in place of the player's lane and mine options for a host. A chart-forced arrangement is not counted as the player's lane assist. NONSTOP diagnoses these options per stage instead of applying them.
