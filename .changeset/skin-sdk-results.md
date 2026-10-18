---
'@be-music/skin-sdk': minor
---

Take the result and the scoring vocabulary from the packages that define them, so a skin, the host and the Leaderboard speak one vocabulary:

- `BeMusicResultData` is `@be-music/scene-model`'s `PlayResult`, the one result payload of a single play, a course stage, a course run or a NONSTOP run. A result says which run it is of (`run`: `single`, `stage`, `course`, `nonstop`) and carries the course it belongs to (`course`), a course run's stages reached and trophy (`courseRun`) and each judgment's early / late count (`earlyLate`). `GaugeHistorySample`, `ScoreHistorySample`, `BeMusicJudge`, `BeMusicSide`, `BeMusicJudgeTiming` and `BeMusicLaneCover` are aliases of its types.
- `resolveResultVerdict` names a result's headline: `STAGE CLEAR` / `FAILED` for one play, `COURSE CLEAR` / `COURSE FAILED` for a course run.
- `BeMusicClearLamp` is `ClearLamp` (`@be-music/player/ruleset`), `BeMusicGaugeType` is `GaugeType`, and `BeMusicSongRecord` is `BestRecord` (`@be-music/player/records`); the types are unchanged.

`resolveResultLamp` now reads the lamp through the shared clear-lamp rule, so a cleared play that stopped before its last note reads `CLEAR` rather than `FULL COMBO`.
