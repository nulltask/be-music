---
'@be-music/player-scene-model': minor
---

Add the ranking targets (`IR_NEXT_*`, `IR_RANK_*`, `IR_RANKRATE_*`, in beatoraja's default list) and `SCORE_RATE` to `SCORE_TARGET_IDS`, with the `scoreTargetRate` play option, `parseRankingScoreTarget`, `resolveRankingTargetIndex` and `clampScoreTargetRate`. `resolveScoreTarget` takes the rate and the ranking's score.
