---
'@be-music/player': patch
---

Fix the lane mode depending on more than the lanes a chart plays:

- A mine or invisible object on lane 8 / 9 turned a 5 KEY chart into 7 KEY, which under the beatoraja ruleset also switched to the 7 KEY judge windows. The engine now takes the lane mode from `resolveChartPlayVariant` (`@be-music/chart`) over the resolved chart's events, `laneModeExtension` and `#PLAYER` whenever the host does not declare `playVariant`, and `createLaneBindings` / `resolveLaneDisplayMode` use the same rule. PMS-STD content (`22..25` without `21` / `26..29`) is now 9 KEY in the engine, as it already was on the web.
- A `.bme` chart without a 6 / 7 key column was forced to 7 / 14 KEY: it now plays as 5 / 10 KEY, since the lane mode comes from the lanes the chart uses, as in beatoraja, and only `.pms` still names a mode through `laneModeExtension`. Under the beatoraja ruleset such a chart also gets the 5 KEY judge windows.
