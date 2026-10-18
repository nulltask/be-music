---
'@be-music/player-tui': patch
---

Show the same lanes as the web player. The CLI's lane mode now follows the shared `resolveChartPlayVariant` rule (`@be-music/chart`), which fixes it disagreeing with the web player's:

- A `.bme` chart without a 6 / 7 key column opens as 5 / 10 KEY instead of 7 / 14 KEY, so the CLI no longer shows two unused key lanes for it: the lane mode comes from the lanes the chart uses, as in beatoraja.
- A mine or invisible object on lane 8 / 9 no longer turns a 5 KEY chart into 7 KEY.
- `createLaneBindings` / `resolveLaneDisplayMode` report PMS-STD content (`22..25` without `21` / `26..29`) as 9 KEY instead of 5 KEY DP / 14 KEY DP.
- The 24 / 48 KEY wheel lanes are drawn in the scratch colours, left of the 1P keys and right of the 2P keys.
