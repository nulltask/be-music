---
'@be-music/player': minor
---

Export `resolvePlayChart` and `resolveChartRulesetFacts` from `@be-music/player/playlog` too. They now live in a runtime-neutral module apart from the engine's audio and UI start-up, so a play-log verifier (the Leaderboard Worker) can rebuild the chart a play was played on without bundling the audio driver; `@be-music/player/core/engine` still exports them.
