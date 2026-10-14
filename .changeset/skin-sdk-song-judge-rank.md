---
'@be-music/skin-sdk': minor
---

Add `judgeRank` to `resolveSongStats`: the chart's judge rank as players read it. It gives `VERY HARD` … `VERY EASY` for `#RANK 0`–`4`, the `#DEFEXRANK` / bmson `judge_rank` value when the chart sets one, `NORMAL` when it sets neither (bmson: `100`), and `RANDOM` when `#EXRANKxx` changes it mid-chart. The rules match the player's own song screens.
