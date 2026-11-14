---
'@be-music/player-engine': patch
---

Under LR2 judgment, `#DEFEXRANK` and `#EXRANKxx` now scale the `#RANK 2` windows by their percentage, the base value the command's definition names: `#DEFEXRANK 120` is ±21.6 / ±48 / ±120 ms, where it was ±19.8 / ±52 / ±112 ms by interpolation between LR2's NORMAL and EASY ranks. bmson `judge_rank` and PRACTICE's JUDGERANK keep the interpolation. Replays re-judge with the new windows.
