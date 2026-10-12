---
'@be-music/player-web': minor
---

Resolve `#RANDOM` / `#SWITCH` once per play through `resolvePlayChart` (`@be-music/player`) and hand the engine the resolved chart together with its draws (`engineOptions.randomDraws`), so the engine never rolls the chart again and its RANDOM summary names the branches that play. `prepareBeatorajaGameplayChart` takes an upstream resolution as `preResolved` (chart and draws, replacing `preResolvedChart`) and returns the draws it used as `randomDraws`. The internal `toEngineChart` workaround is gone, since a resolved chart no longer carries its control flow.
