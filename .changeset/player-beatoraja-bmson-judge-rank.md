---
'@be-music/player': patch
---

Fix the beatoraja ruleset judging a bmson chart without `judge_rank` as BMS `#RANK 2` (judgerank 75, PGREAT ±15 ms in 7 KEY) instead of the bmson default `judge_rank: 100` (±20 ms). The default is applied in the ruleset, so a play-log replay of such a chart resolves the same windows.
