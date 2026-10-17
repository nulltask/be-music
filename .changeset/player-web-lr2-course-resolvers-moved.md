---
'@be-music/player-web': minor
---

The LR2 course resolvers moved to `@be-music/lr2-skin/state` and are no longer exported from `@be-music/player-web` / `@be-music/player-web/scenes`: import `resolveLr2CourseOps`, `resolveLr2CourseNumber`, `resolveLr2CourseText`, `resolveLr2CourseConnectionText`, `resolveLr2CourseStageDifficultyOps`, `resolveLr2CourseMakerOps`, `resolveLr2CourseMakerText`, `resolveLr2CourseMakerAction`, `resolveLr2CourseMakerButtonState`, `resolveLr2CourseDraftInfo`, `resolveLr2NonstopStage`, `resolveLr2JudgeCombo` and `lr2ShowsCourseCombo` from there. The LR2 scenes behave as before.
