---
'@be-music/player': minor
---

`resolveDisplayedJudgeRankValue` and `resolveDisplayedJudgeRankLabel` (`@be-music/player/utils`) now also accept a `ResolvedChart` and read its judge-rank facts (`#RANK`, `#DEFEXRANK` / bmson `judge_rank`, the `#EXRANKxx` changes) instead of re-reading the chart; a source chart is resolved first. The format defaults (bmson `judge_rank` 100, BMS NORMAL) are still filled by these helpers and by the rulesets, because play logs record only the values a chart sets.
