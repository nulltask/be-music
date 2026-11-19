---
'@be-music/player-engine': patch
---

Speed up replay re-judging and ruleset resolution, which had become several times slower:

- `resolveRulesetConfig` counts a replay's notes in one pass and resolves a lane mode's scratch lanes once, instead of looking them up through the play-mode table on every call.
- Gauge picks are split by one table lookup, and bare picks skip the split.
- beatoraja's float32 gauge tables and class gauge rows are built without per-call closures and copies.
- `applyChartPlayOptions`, `createInputSourceTable`, `resolveCourseStageStartGauge` and the course and record lamp helpers build their results without spreading optional fields or deleting absent keys.
