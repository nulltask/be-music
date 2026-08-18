---
'@be-music/beatoraja-skin': minor
'@be-music/player-web': minor
'@be-music/player': minor
---

Run the selected gauge through the active compat ruleset instead of a hardcoded LR2 groove curve.

`PlayerOptions.gauge` now picks a gauge out of the ruleset's own line-up (LR2 `GROOVE` / `EASY` / `HARD` / `EX-HARD` /
`DEATH`, beatoraja `NORMAL` / `ASSIST-EASY` / `EASY` / `HARD` / `EX-HARD` / `HAZARD`, IIDX `NORMAL` / `EASY` /
`ASSISTED-EASY` / `HARD` / `EX-HARD`) and the engine runs that gauge's real curve — per-judge deltas, TOTAL scaling,
guts softening, death border, and the survival-vs-threshold clear rule. Previously the picker was cosmetic: HARD
rendered red but ran GROOVE's numbers and reported CLEARED at 2 %.

Consequences:

- `PlayerSummary.gauge` gains `survival` and `failedMidPlay`, and its `type` widens from the LR2-only union to the
  ruleset-scoped gauge id.
- The LR2 `#TOTAL` default is now LR2's note-count formula (`LR2_bmsload.cpp`) rather than a flat 160.
- `@be-music/player/core/groove-gauge` keeps only `GrooveGaugeType` / `GrooveGaugeJudgeKind`; the gauge state helpers
  (`createGrooveGaugeState`, `applyGrooveGaugeJudge`, `applyGrooveGaugeRawDelta`, `isGrooveGaugeCleared`) are removed
  in favour of the ruleset's `RulesetGauge`.
- `beatorajaGaugeModeFromString` and `computeClearLampOp` accept every ruleset's gauge id, so beatoraja skins show the
  ASSIST-EASY and EX-HARD lamps instead of collapsing them onto NORMAL.
