# @be-music/beatoraja-skin

## 0.2.0

### Minor Changes

- 0103435: Run the selected gauge through the active compat ruleset instead of a hardcoded LR2 groove curve.
  
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

## 0.1.2

### Patch Changes

- Updated dependencies [ca1012c]
  - @be-music/utils@0.3.0

## 0.1.1

### Patch Changes

- 69f77d1: Cache a `BeatorajaPathIndex` per source map (WeakMap-keyed) that groups files by lowercased parent directory. `expandBeatorajaWildcard` used to walk every key in the source map and re-run `path.toLowerCase()` + `lastIndexOf('/')` per call — once per `source[]` entry in `bundleBeatorajaSources`. Now resolves in `O(filesInTargetDir)` via the precomputed directory bucket. `describeMissingWildcardDirectory` shares the same index instead of running two more full scans.
- Updated dependencies [73dff9a]
  - @be-music/utils@0.2.1

## 0.1.0

### Minor Changes

- 06a2db9: Initial release: a renderer-independent parser and normalizer for beatoraja's JSON and Lua skin formats.

  Covers the 2-phase Lua evaluation contract (`skin_config = nil` → header → populated `main()`) on a Fengari sandbox, `if` / `values` flattening, `*` wildcard / `filepath[]` overrides, case-insensitive asset lookup, and per-scene theme discovery (play / select / decide / result / course-result / grade-result). Scene elements have strict-typed normalizers (`image`, `imageset`, `value`, `float-value`, `text`, `slider`, `note`, `judge`, `gauge`, and the rest) with keyframe carry-forward, linear interpolation, `loop` wrap-around, and `divx` / `divy` cell math. `skin/default/` discovery wins ties against community themes that shadow it.
