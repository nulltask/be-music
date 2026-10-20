---
'@be-music/player-scene-model': minor
---

Use `PlayResult.chart` and `PlayResult.replay` for result data, and `JudgmentKind` / `JudgmentTiming` for judgment types. Rename the current-view snapshot helper to `captureReplayView` to distinguish capture from replay-view resolution. Previous names are removed.

Rename the package from `@be-music/scene-model` to `@be-music/player-scene-model` to identify its role consistently. Update imports and package filters to the new name.
