---
'@be-music/player-web': patch
---

The scenes' course view, course combo and play-log view helpers now come from `@be-music/scene-model` and are re-exported unchanged: `SceneCourseInfo` / `resolveSceneCourseInfo` (`CourseView` / `resolveCourseView`), `createCourseCombo` / `advanceCourseCombo`, `PlaylogViewCursor` and `resolveBeatorajaPlaylogView`. `PixiGameplayResultData` is the scene model's `PlayResult`: a course run's result has `run: 'course'` in place of `courseResult`.
