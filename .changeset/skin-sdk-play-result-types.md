---
'@be-music/skin-sdk': minor
---

Take the result and play types from `@be-music/scene-model`: `BeMusicResultData` is its `PlayResult`, the one result payload of a single play, a course stage, a course run or a NONSTOP run, and `GaugeHistorySample`, `ScoreHistorySample`, `BeMusicJudge`, `BeMusicSide`, `BeMusicJudgeTiming` and `BeMusicLaneCover` are aliases of its types. A result now says which run it is of (`run`: `single`, `stage`, `course`, `nonstop`), carries the course it belongs to (`course`), a course run's stages reached and trophy (`courseRun`) and each judgment's early / late count (`earlyLate`).

Migration: `courseResult` is gone; a whole EXPERT / GRADE course run's result has `run: 'course'`, which `resolveResultVerdict` reads for COURSE CLEAR / COURSE FAILED.
