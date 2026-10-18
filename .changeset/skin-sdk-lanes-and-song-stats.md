---
'@be-music/skin-sdk': minor
---

Follow the player's chart rules in lanes and song facts:

- `BeMusicLaneKind` gains `wheel-up` / `wheel-down` for the 24 / 48 KEY wheel lanes, and the skinless layout places the wheel on each side's outer edge, as wide as a scratch lane. `formatPlayVariantLabel` honours the bmson keyboard `mode_hint`.
- `resolveSongStats` gains `judgeRank`, the chart's judge rank as players read it: `VERY HARD` … `VERY EASY` for `#RANK 0`–`4`, the `#DEFEXRANK` / bmson `judge_rank` value when the chart sets one, `NORMAL` when it sets neither (bmson: `100`), and `RANDOM` when `#EXRANKxx` changes it mid-chart.
- The song facts (length, BPM range, long notes, mines, stops) now come from the resolved chart (`resolveChart` in `@be-music/chart`), the same rules the player plays by, and the package no longer depends on `@be-music/audio-renderer`.
