---
'@be-music/player': minor
---

Add `@be-music/player/ruleset`, the one vocabulary for how a play is judged that hosts, skins and the Leaderboard share, so each no longer keeps its own copy:

- `GaugeType` and `GAUGE_TYPES` / `isGaugeType`: the gauge the player picks (`GROOVE`, `HARD`, `DEATH`, `EASY`, in LR2's button order).
- `ClearLamp` and `CLEAR_LAMPS` / `isClearLamp` / `clearLampRank` / `clearLampAtRank` / `betterClearLamp` / `topClearLamp`: the clear lamps from `NO_PLAY` to `MAX`, ranked 0–9.
- `resolveClearLamp` (a single play) and `resolveCourseClearLamp` (a course run): the one clear-lamp rule, which keeps each judge ruleset's own lamps (LR2 and IIDX top out at FULL COMBO, an LR2 DEATH clear is NORMAL), with `isFullCombo`.
- `resolveMissCount`: BP, BAD + POOR + empty POOR, plus the notes a play never judged where a course counts them.
- `PlaylogRulesetId`, the judge ruleset ids.

`playlog.resolveCourseLamp` now applies `resolveCourseClearLamp`, and `CourseClearLamp` is the `ClearLamp`s a course run can earn. `GrooveGaugeType` (`@be-music/player/core/groove-gauge`) is a deprecated alias of `GaugeType`.
