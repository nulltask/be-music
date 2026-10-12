---
'@be-music/stringifier': patch
---

Fix `stringifyBmson` writing a BMS chart's `#RANK` index as the bmson `info.judge_rank`: bmson `judge_rank` is a percentage on the `#DEFEXRANK` axis (`100` = NORMAL), so `#RANK 2` became `judge_rank: 2`, an almost zero-width judge window. A positive `#DEFEXRANK` is now written verbatim, `#RANK 0`–`4` maps to `33` / `67` / `100` / `133` / `167` (the `#DEFEXRANK` value that judges like each rank, with VERY EASY following beatoraja), and any other `#RANK` leaves `judge_rank` out so the bmson default `100` applies. A bmson source keeps its authored `judge_rank` on both the preserved and the regenerated output path.
