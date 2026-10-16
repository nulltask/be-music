---
'@be-music/lr2-skin': minor
---

Add `@be-music/lr2-skin/state`, the pure resolvers that map the scene models of `@be-music/scene-model` to LR2's skin vocabulary. It starts with the course resolvers, moved from `@be-music/player-web`: the course ops (`resolveLr2CourseOps`, `resolveLr2CourseStageDifficultyOps`), numbers (`resolveLr2CourseNumber`) and texts (`resolveLr2CourseText`, `resolveLr2CourseConnectionText`) of a `CourseView`, the course combo LR2 shows (`lr2ShowsCourseCombo`, `resolveLr2JudgeCombo`), the stage a NONSTOP play shows (`resolveLr2NonstopStage`) and the course maker's ops, texts and buttons (`resolveLr2CourseMakerOps`, `resolveLr2CourseMakerText`, `resolveLr2CourseMakerAction`, `resolveLr2CourseMakerButtonState`, `resolveLr2CourseDraftInfo`). The package now depends on `@be-music/scene-model` and `@be-music/player`.
