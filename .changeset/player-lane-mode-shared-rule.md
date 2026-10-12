---
'@be-music/player': patch
---

Fix the lane mode depending on mines, invisible objects, and inputs outside the shared rule: a mine or invisible object on lane 8 / 9 turned a 5 KEY chart into 7 KEY, which under the beatoraja ruleset also switched to the 7 KEY judge windows. The engine now takes the lane mode from `resolveChartPlayVariant` (`@be-music/chart`) over the resolved chart's events, `laneModeExtension`, and `#PLAYER` whenever the host does not declare `playVariant`, and `createLaneBindings` / `resolveLaneDisplayMode` use the same rule. PMS-STD content (`22..25` without `21` / `26..29`) is now 9 KEY in the engine as it already was on the web.
