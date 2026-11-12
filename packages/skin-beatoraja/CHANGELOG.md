# @be-music/skin-beatoraja

## 0.8.0

### Minor Changes

- a15f307: Find a sound set's guide sounds, and fix the sign of the judge timing number.
  
  - Find a sound set's guide sounds (`guide-pg` to `guide-ms`, in `sound/` then `defaultsound/`) with `discoverBeatorajaSystemSoundPaths`.
  - A beatoraja skin's judge timing number (525) read with the wrong sign: it is now positive for an early press, as beatoraja's `getRecentJudgeTiming` is.
  - beatoraja skins draw the corrected LR2 HAZARD gauge as HAZARD.
  - The RANDOM slot of the `option1p` / `option2p` buttons steps the shared RANDOM, now one option for every source.

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.18.0`, `@be-music/player-scene-model@0.9.0`, `@be-music/skin-lr2@0.7.4`

## 0.7.3

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.17.0`, `@be-music/player-scene-model@0.8.1`, `@be-music/skin-lr2@0.7.3`

## 0.7.2

### Patch Changes

- 81f6f5e: The decide screen lights the difficulty ops of the difficulty a chart's names, else its note count, suggest when it has no `#DIFFICULTY`.
- Updated dependencies: `@be-music/skin-lr2@0.7.2`, `@be-music/player-engine@0.16.0`, `@be-music/player-scene-model@0.8.0`

## 0.7.1

### Patch Changes

- ba20133: The result ops lit neither autoplay op. They now light `AUTOPLAY_ON` for a full AUTO play's result and `AUTOPLAY_OFF` otherwise, as beatoraja's `OPTION_AUTOPLAYON` reads the play mode on the result screen too.
- Updated dependencies: `@be-music/player-engine@0.15.1`, `@be-music/player-scene-model@0.7.0`, `@be-music/skin-lr2@0.7.1`

## 0.7.0

### Minor Changes

- 335f3c1: Recognize JSON skins when a theme folder is opened directly without a `skin/` ancestor, while ignoring unrelated settings files. Match LuaJ module loading for missing, nil-returning, false-returning, and recursive modules, and execute `dofile` on every call with all of its return values so skin fallback logic and repeated layout scripts behave as authored.

  Correct LIFT and HIDDEN+ offsets in skin coordinates and supply the lane-cover offset so decorations and cover readouts move in the direction authored by the skin. Respect the LIFT enable switch when computing those offsets.

  Preserve parent positional offset IDs as `BeatorajaDestinationGroup.parentOffsets` when expanding relative judge combo numbers, so they follow the judge word during LIFT and judge-position changes.

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.15.0`, `@be-music/skin-lr2@0.7.0`, `@be-music/player-scene-model@0.6.1`

## 0.6.1

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.14.0`, `@be-music/player-scene-model@0.6.0`, `@be-music/skin-lr2@0.6.1`

## 0.6.0

### Minor Changes

- f492d21: A play skin's judgment and combo display can now be hidden: every `judge[]` image and combo digit is gated on a new synthetic op, `BEATORAJA_OP.JUDGE_DISPLAY_HIDDEN`, which `resolveBeatorajaJudgeDisplayOps` lights while the play runs LR2 SILENT automatic judge timing (LR2 shows no NOWJUDGE / NOWCOMBO there) and, with its new optional `chartHidesJudge` flag, for a chart's HIDJUDGE. `resolveBeatorajaJudgeEffect` takes an optional `{ bombs: false }` that leaves out the bomb timers for a chart's DARK2.
- eedc8a9: `BeatorajaPlayNumberInput.targetEXScore` feeds numbers 121-123 (target score, its rate and the digits after the dot over the chart's notes), which read 0 without one.

### Patch Changes

- 232d977: LIGHT ASSIST EASY lights clear-lamp op 1101 and reads clear index 3, and ASSIST EASY lights op 1100 and reads index 2, as beatoraja's `ClearType` numbers them. Before, the ASSIST EASY gauge's clear lit op 1100.
- b62ff09: The lane option buttons (42 / 43) step beatoraja's own RANDOM, S-RANDOM and CONVERGE and `optiondp` (54) its own BATTLE, and another source's value shows on the slot of its bare name (ADR 0019).
- Updated dependencies: `@be-music/player-engine@0.13.0`, `@be-music/player-scene-model@0.5.0`, `@be-music/skin-lr2@0.6.0`

## 0.5.1

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.12.0`, `@be-music/shared-utils@0.7.0`, `@be-music/player-scene-model@0.4.0`, `@be-music/skin-lr2@0.5.0`

## 0.5.0

### Minor Changes

- 6e5213a: Add HCN timer ID helpers and deterministic score, HCN, and POMYU character timer transitions so skins can animate rank thresholds, changing holds, character reactions, and music completion.
- 1f2efc9: Carry optional emptyPoor counts in score inputs and judgedPoor in result facts. Show MISS and combined miss numbers separately from note POORs, avoiding double counting when an LR2 result folds empty POORs into its displayed count.
- 7602368: Add resolveBeatorajaGaugeTypeOps and use it for play and result gauge-frame conditions. HARD and course survival gauges now select the hard frame, and the EX condition follows beatoraja’s gauge classes, including EASY and ASSIST-EASY.
- 1b2dbc6: Expose the skin's loading timing fields in typed headers and retain them during Lua header extraction so the browser can honor authored loading and READY intervals.
- d1445d1: Add resolveBeatorajaOptionIndex for shared LN mode, HS-FIX and clear-lamp image indices so image refs and Lua event_index display the same selected options and records.
- ba9dc79: Add `BEATORAJA_OP.CONSTANT` (400) and `resolveBeatorajaConstantOps`, which lights it while the player's Visual CONSTANT setting is on, as beatoraja's `BooleanPropertyFactory` does.
- b3f593e: Discover the optional `playStop` system sound in dropped themes.
- 9995058: Add `resolveBeatorajaOptionButton` and `resolveBeatorajaPlayOptionIndex`: the select screen's option buttons step the play options and their labels read them, as beatoraja does. The RANDOM 1P / 2P buttons (42 / 43) step through beatoraja 0.8.9's ten lane options in its order for the play mode passed in (`BeatorajaOptionButtonMode`: `Random.OPTION_GENERAL`, or `Random.OPTION_PMS` for PMS), and the automatic display-timing button (75) switches the automatic judge-timing mode between OFF and beatoraja's calibration, reading LR2's modes as off (#777).
  Report START BPM HS-FIX with beatoraja's original option index, show the judge display timing on number 12, and show the player's LN MODE on the LNMODE image where the chart leaves its long-note mode undefined.
- 54698f1: Resolve beatoraja's replay slot ops (196-198, 1196-1208) on the select and result screens and the replay buttons (19, 316-318), and pick a theme's `resultclose` / `course_close` sounds instead of taking `resultclose.wav` as the generic result jingle.
- d9f371a: New `resolveBeatorajaSeekTimers`: the timers a play skin changes when the play seeks — every running timer but the scene's stops, the rhythm timer starts again, and the full gauge and each side's end of the notes start once when the second sought is past them.

### Patch Changes

- 8671b85: Stop the GAUGE_MAX timer when the gauge drops below its actual maximum and restart it on each return to full, so skin effects follow the current gauge instead of remaining active for the rest of the play.
- f0c48b6: Restore delayed Lua draw predicates such as WMII_FHD lasers and key flashes by exposing `os.clock()` in seconds from the host-provided scene clock.
- 63ebb43: JSON skins load faster: `relaxBeatorajaJSON` copies the untouched runs between its edits as slices instead of rebuilding the text one character at a time, and returns well-formed JSON unchanged, about 2.3× faster on the bundled play skin.
- Updated dependencies: `@be-music/player-engine@0.11.0`, `@be-music/player-scene-model@0.3.0`, `@be-music/skin-lr2@0.4.0`, `@be-music/shared-utils@0.6.0`

## 0.4.0

### Minor Changes

- ad210fa: Use `BeatorajaChartTextInput`, `resolveBeatorajaChartText`, and chart fields for scene text inputs. Adopt canonical replay and judgment models while preserving beatoraja format keys and operation identifiers.
  
  Rename the package from `@be-music/beatoraja-skin` to `@be-music/skin-beatoraja` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies: `@be-music/skin-lr2@0.3.0`, `@be-music/player-engine@0.10.0`, `@be-music/player-scene-model@0.2.0`, `@be-music/shared-utils@0.5.0`

## 0.3.0

### Minor Changes

- 8a051a5: Provide `@be-music/skin-beatoraja/scene` with deterministic resolvers for select, decide, play, result and course screens, including numbers, text, options, timers, graphs, offsets and system sounds.
  
  - Extend named skin IDs for course constraints, stages, random-course bars, folder statistics and note density.
  - Resolve skin fallback consistently across That-Which-Must-Not-Be-Named, PMS and keyboard modes, and expose the selected fallback variant.
  - Match beatoraja's rank, main BPM, lane-cover and LIFT values, including per-mille cover readouts.
  - Load Lua skins without unnecessary console output.
  
  Migration: use the canonical uppercase-abbreviation API names. Resolve clear lamps with `@be-music/player-engine/ruleset` and map them with `beatorajaClearLampOp`; `computeClearLampOp` is removed.

### Patch Changes

- Updated dependencies: `@be-music/skin-lr2@0.2.0`, `@be-music/player-engine@0.9.0`, `@be-music/player-scene-model@0.1.0`, `@be-music/shared-utils@0.4.0`
## 0.2.0

### Minor Changes

- 0103435: Run the selected gauge through the active compat ruleset instead of a hardcoded LR2 groove curve.
  
  `PlayerOptions.gauge` now picks a gauge out of the ruleset's own line-up (LR2 `GROOVE` / `EASY` / `HARD` / `EX-HARD` /
  `DEATH`, beatoraja `NORMAL` / `ASSIST-EASY` / `EASY` / `HARD` / `EX-HARD` / `HAZARD`, That-Which-Must-Not-Be-Named `NORMAL` / `EASY` /
  `ASSISTED-EASY` / `HARD` / `EX-HARD`) and the engine runs that gauge's real curve — per-judge deltas, TOTAL scaling,
  guts softening, death border, and the survival-vs-threshold clear rule. Previously the picker was cosmetic: HARD
  rendered red but ran GROOVE's numbers and reported CLEARED at 2 %.
  
  Consequences:
  
  - `PlayerSummary.gauge` gains `survival` and `failedMidPlay`, and its `type` widens from the LR2-only union to the
    ruleset-scoped gauge id.
  - The LR2 `#TOTAL` default is now LR2's note-count formula (`LR2_bmsload.cpp`) rather than a flat 160.
  - `@be-music/player-engine/core/groove-gauge` keeps only `GrooveGaugeType` / `GrooveGaugeJudgeKind`; the gauge state helpers
    (`createGrooveGaugeState`, `applyGrooveGaugeJudge`, `applyGrooveGaugeRawDelta`, `isGrooveGaugeCleared`) are removed
    in favour of the ruleset's `RulesetGauge`.
  - `beatorajaGaugeModeFromString` and `computeClearLampOp` accept every ruleset's gauge id, so beatoraja skins show the
    ASSIST-EASY and EX-HARD lamps instead of collapsing them onto NORMAL.

## 0.1.2

### Patch Changes

- Updated dependencies: `@be-music/shared-utils@0.3.0`

## 0.1.1

### Patch Changes

- 69f77d1: Cache a `BeatorajaPathIndex` per source map (WeakMap-keyed) that groups files by lowercased parent directory. `expandBeatorajaWildcard` used to walk every key in the source map and re-run `path.toLowerCase()` + `lastIndexOf('/')` per call — once per `source[]` entry in `bundleBeatorajaSources`. Now resolves in `O(filesInTargetDir)` via the precomputed directory bucket. `describeMissingWildcardDirectory` shares the same index instead of running two more full scans.
- Updated dependencies: `@be-music/shared-utils@0.2.1`

## 0.1.0

### Minor Changes

- 06a2db9: Initial release: a renderer-independent parser and normalizer for beatoraja's JSON and Lua skin formats.

  Covers the 2-phase Lua evaluation contract (`skin_config = nil` → header → populated `main()`) on a Fengari sandbox, `if` / `values` flattening, `*` wildcard / `filepath[]` overrides, case-insensitive asset lookup, and per-scene theme discovery (play / select / decide / result / course-result / grade-result). Scene elements have strict-typed normalizers (`image`, `imageset`, `value`, `float-value`, `text`, `slider`, `note`, `judge`, `gauge`, and the rest) with keyframe carry-forward, linear interpolation, `loop` wrap-around, and `divx` / `divy` cell math. `skin/default/` discovery wins ties against community themes that shadow it.
