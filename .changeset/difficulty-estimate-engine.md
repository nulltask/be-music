---
'@be-music/player-engine': minor
---

Add `estimateDifficultyFromNames`, which reads the `#DIFFICULTY` (1 BEGINNER … 5 INSANE) a chart that names none suggests from its subtitle, the bracketed parts of its title, its bmson chart name and its file name (`[SP ANOTHER]`, `_hyper`, `7a`, `SPH`, `EX2`), and `resolveDisplayedDifficulty`, which returns the declared value or that estimate marked `estimated`. Both are exported from `@be-music/player-engine/display`; the rules were tuned on charts that do name their difficulty, where they agree with the declared value 97% of the time.
