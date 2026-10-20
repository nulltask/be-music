# @be-music/player-scene-model

## 0.2.0

### Minor Changes

- 9a0c3f9: Use `PlayResult.chart` and `PlayResult.replay` for result data, and `JudgmentKind` / `JudgmentTiming` for judgment types. Rename the current-view snapshot helper to `captureReplayView` to distinguish capture from replay-view resolution. Previous names are removed.
  
  Rename the package from `@be-music/scene-model` to `@be-music/player-scene-model` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies [dca9a2f]
- Updated dependencies [dca9a2f]
- Updated dependencies [9a0c3f9]
  - @be-music/chart-model@0.6.0
  - @be-music/chart-source@0.4.0
  - @be-music/player-engine@0.10.0

## 0.1.0

### Minor Changes

- b2818d0: Provide runtime-neutral, deterministic models shared by built-in, LR2 and beatoraja scene implementations.
  
  - Model chart/folder/course libraries, immutable browsing state, search, sorting, filters, favourites, cursor restoration and play options.
  - Model play state, gauges, scores, timed judgments, hi-speed, lane covers, display values and recorded play views.
  - Model results, course views, course combos, verdicts and system sounds for single plays and course runs.
  
  Use chart-based library vocabulary and canonical abbreviation spellings, including `BGAMode`, `HSFix` and `referenceBPM`.

### Patch Changes

- Updated dependencies [b2818d0]
  - @be-music/chart-model@0.5.0
  - @be-music/chart-source@0.3.0
  - @be-music/player-engine@0.9.0
