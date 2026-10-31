# @be-music/player-scene-model

## 0.4.0

### Minor Changes

- afc65fb: Preserve declared generic bmson play variants and key counts in the library even when only a few keys contain notes.
- 5992a52: Add compulsory chart hi-speed state that bypasses user limits and temporarily overrides user, course and replay speed controls. Preserve the underlying user view for exact restoration and separate replay recording.
- 3f3de70: Expose the bmson zero-total policy in shared play options, with validated choices and a beatoraja-compatible default.
- 3928de4: Offer AUTO and COUPLE battle selections while retaining OFF as the compatibility default.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.8.0`, `@be-music/player-engine@0.12.0`, `@be-music/chart-source@0.6.0`, `@be-music/shared-utils@0.7.0`

## 0.3.0

### Minor Changes

- 3a5d9c3: Accept final full-combo eligibility in score inputs and preserve broken combos when finishing a play, keeping result lamps and combo displays consistent after empty POOR.
- a8896a9: A search that starts with `?` is a chart filter expression, the SQL `WHERE` clause beatoraja random courses use: the list shows the charts it selects (from every folder at the root), in its own `ORDER BY` order when it has one. Charts are read through the new `Library.chartFilterRecord`, else `libraryChartFilterRecord`. An expression that does not parse filters nothing, and `browseSearchError` says why. New `parseBrowseSearch`, `browseSearchError`, `libraryChartFilterRecord` and `filterEntriesByChartQuery`.
- 85f13dc: Add the `playStop` system sound slot and map LR2 `STOP` and beatoraja theme paths to it.
- 3c2ea6b: Add `PlayResult.fromReplay` (and a `fromReplay` option of `playResultFromPlayState` and `playResultFromCourseRun`), so a skin can mark the result of a replay played back, a course replay's stage and course results included.
- b09a6cf: Add the play options and choices of the judgment, hi-speed and view options, the lane arrangements, the chart modifiers, the gauge options, the battle and conversion modes, CUSTOM JUDGE and PRACTICE, among them:
  
  - START BPM hi-speed anchoring, keeping LR2's button order.
  - The source-defined OFF, ON, SUDDEN-only and HIDDEN/LIFT-only display-area visibility choices.
  - OFF, AC LEGACY NOTE and beatoraja LN REMOVE.
  - EX-HARD through the shared option validation, keeping LR2's gauge cycling.
  - `judgeTimingAutoAdjust`, the automatic judge timing mode (`'OFF'`, `'BEATORAJA'`, `'LR2-ON'`, `'LR2-SILENT'`, default `'OFF'`) (#777).
  - `bpmChangeWarning` (off by default) for AC 34's BPM-change warning.
  
  SUDDEN+ is kept as a fraction of the lane above the LIFT, with a LIFT per side switched on and off on its own, and the floating hi-speed's covers as fractions of the whole lane. `resolveConstantVisibility` decides Visual CONSTANT and takes `noSpeed`, which turns it off for a course with the `NO_SPEED` constraint, as beatoraja's `LaneRenderer` does. A two-player play has a 2P result (`PlayResult.secondPlayer`).
  `resolveRandomModes` offers the lane options only one source defines under every ruleset: R-RANDOM, SPIRAL, H-RANDOM, ALL-SCR, RANDOM-EX, S-RANDOM-EX and the PMS arrangements (beatoraja), and SCATTER (LR2), while CONVERGE stays with LR2 and beatoraja. Its second argument marks the 1P side of a chart copied onto both sides, which adds SYNCHRONIZE RANDOM and SYMMETRY RANDOM, and `isDuplicatedBattleChoice` tells those battle modes apart (#774).
- 85e11f7: `LibraryCourse.randomMix` marks LR2's RANDOM MIX bar, and `resolveLR2RandomMixKeyMode` gives the key mode a RANDOM MIX draws under a key filter (7 under ALL, as LR2 does).
- d0939cc: Add the replay slot model (`REPLAY_SLOT_COUNT`, `ReplaySlotState`, `firstReplaySlot`, `stepReplaySlot`) and the `resultClose` / `courseClose` system sound slots, which `resolveResultJingles` returns as the result's `close` sound.
- 3e694df: `reducePlayState` takes a `seek` event with the engine's `PlaySeekSnapshot`: the play state becomes the one the engine rebuilt at the second sought (graphs, timings, early / late counts, gauge, EX score, combo and max combo), so a play that seeks reads as one that judged the same notes live, and a frame's own `combo`, `maxCombo` and course combo win over what the judgments counted. `ReplayViewCursor.seek(timeUs)` returns the recorded view at a seek target, even within the previous change interval, so hosts can reapply it.
  Play results carry a `practice` flag and omit replay data when they are practice, and live course-stage outcomes are carried apart from replays so a practice course builds its result without a course replay.

### Patch Changes

- a83e326: Resolve course results using the `____` identifier for the That-Which-Must-Not-Be-Named ruleset.
- aeac0d3: LR2 full combos now show a cleared result even below the gauge border, keeping the result verdict consistent with its FULL COMBO lamp.
- Updated dependencies: `@be-music/player-engine@0.11.0`, `@be-music/chart-model@0.7.0`, `@be-music/chart-source@0.5.0`, `@be-music/shared-utils@0.6.0`

## 0.2.0

### Minor Changes

- 9a0c3f9: Use `PlayResult.chart` and `PlayResult.replay` for result data, and `JudgmentKind` / `JudgmentTiming` for judgment types. Rename the current-view snapshot helper to `captureReplayView` to distinguish capture from replay-view resolution. Previous names are removed.
  
  Rename the package from `@be-music/scene-model` to `@be-music/player-scene-model` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.6.0`, `@be-music/chart-source@0.4.0`, `@be-music/player-engine@0.10.0`

## 0.1.0

### Minor Changes

- b2818d0: Provide runtime-neutral, deterministic models shared by built-in, LR2 and beatoraja scene implementations.
  
  - Model chart/folder/course libraries, immutable browsing state, search, sorting, filters, favourites, cursor restoration and play options.
  - Model play state, gauges, scores, timed judgments, hi-speed, lane covers, display values and recorded play views.
  - Model results, course views, course combos, verdicts and system sounds for single plays and course runs.
  
  Use chart-based library vocabulary and canonical abbreviation spellings, including `BGAMode`, `HSFix` and `referenceBPM`.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.5.0`, `@be-music/chart-source@0.3.0`, `@be-music/player-engine@0.9.0`
