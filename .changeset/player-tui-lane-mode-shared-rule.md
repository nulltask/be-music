---
'@be-music/player-tui': patch
---

The CLI's lane mode now follows the shared `resolveChartPlayVariant` rule the web player uses, so a mine or invisible object on lane 8 / 9 no longer turns a 5 KEY chart into 7 KEY, and `createLaneBindings` / `resolveLaneDisplayMode` report PMS-STD content (`22..25` without `21` / `26..29`) as 9 KEY instead of 5 KEY DP / 14 KEY DP.
