---
'@be-music/player-engine': minor
---

Use replay terminology throughout the recording API: import from `@be-music/player-engine/replay` and use `BeMusicReplay`, `parseReplay`, `serializeReplay`, `recordReplay`, and `onReplayRecorded`. Rename judgment and course-chart types and helpers, including `JudgmentKind`, `RulesetId`, and `CourseChartRecord`. The previous names and subpath are removed; serialized records use the replay format identifiers and field names.

Rename the package from `@be-music/player` to `@be-music/player-engine` to identify its role consistently. Update imports and package filters to the new name.
