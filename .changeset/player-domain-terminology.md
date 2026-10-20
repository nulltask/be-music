---
'@be-music/player': minor
---

Use replay terminology throughout the recording API: import from `@be-music/player/replay` and use `BeMusicReplay`, `parseReplay`, `serializeReplay`, `recordReplay`, and `onReplayRecorded`. Rename judgment and course-chart types and helpers, including `JudgmentKind`, `RulesetId`, and `CourseChartRecord`. The previous names and subpath are removed; serialized records use the replay format identifiers and field names.
