---
'@be-music/player': minor
---

Re-export the score-rate and DJ Rank helpers from `@be-music/player/playlog`: `computeScoreRate`, `resolveIidxRankLabel`, `IIDX_RANK_LABELS`, `IidxRankLabel` and `ScoreSummary`, so consumers reading a result stay on the rules-side entry point instead of importing `@be-music/player/core/scoring` (which keeps working).
