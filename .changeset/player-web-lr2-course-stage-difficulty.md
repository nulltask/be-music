---
'@be-music/player-web': minor
---

LR2 select ops 700-745 were never lit: a course bar now lights `700 + 10 × stage + difficulty` for its stages 1-5 by each chart's `#DIFFICULTY`, as OpenLR2 does (a missing stage and any other bar light the `x0` ops, as LR2 reads 0). `SceneCourseStageInfo` gains `difficulty`; adds `resolveLr2CourseStageDifficultyOps`.
