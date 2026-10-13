---
'@be-music/player': minor
---

Export what the Leaderboard and the player demo used to re-implement: `checkPlaylogEligibility` (whether a play log can be ranked: manual, not aborted, both fingerprints, with assist flags) and `PLAYLOG_ENGINE_VERSION` from `@be-music/player/playlog`, and `IIDX_RANK_LABELS` / `IidxRankLabel` (the DJ Ranks, best first) from `@be-music/player/core/scoring`. `PLAYLOG_SIMULATOR_RULESETS` is now a readonly tuple (`as const`), so it can feed enums and schema pickers directly.
