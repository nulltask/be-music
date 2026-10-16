---
'@be-music/player': minor
---

Export the score vocabulary from `@be-music/player/ruleset`, next to the gauges and clear lamps it is read with: `ScoreSummary`, `JudgeKind`, `createEmptyScore`, `computeScoreRate`, `resolveIidxRankIndexFromScore`, `resolveIidxRankLabel`, `IIDX_RANK_LABELS` / `IidxRankLabel`, `resolveLr2MoneyScore` and `resolveDisplayedPoor`. `@be-music/player/core/scoring` is now a deprecated alias, removed with the other `core/*` subpaths before 1.0. Migration: import these names from `@be-music/player/ruleset`. The engine's score trackers (`createScoreTracker`, `applyJudgeToSummary`, `breakTrackedCombo`, `ScoreTracker`) stay internal and get no new entry point.
