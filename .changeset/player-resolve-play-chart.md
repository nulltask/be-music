---
'@be-music/player': minor
---

Add `resolvePlayChart(source, { random, randomDraws })`, the one step a host takes before a play: it draws the chart's `#RANDOM` / `#SWITCH` outcomes once (or takes recorded ones) and returns the resolved chart together with those draws, ready for `PlayerOptions.randomDraws`, the result screen and the play log.
