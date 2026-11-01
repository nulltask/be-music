---
'@be-music/player-engine': minor
---

A chart's `GAMELEVEL` / `EXTRA` options now select the gauge of a live play in place of the player's pick (both players' in a two-player play), except in a course stage, PRACTICE and a replay. The new `resolveChartGaugeType` in `@be-music/player-engine/ruleset` maps each pair onto the ruleset's own gauges, and the replay records the gauge played.
