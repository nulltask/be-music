---
'@be-music/player': minor
---

Add the course stage rules to `@be-music/player/course`, moved from `@be-music/player-web/collection` so every host reads them from one place: `resolveCourseStageSettings`, `resolveCourseLaneOptions` (with `CourseLaneOption` and `CourseLaneOptions`), `isCourseHiSpeedLocked`, `isLr2GradeCourse` and `resolveLr2GradeCoursePlaySettings` (with `Lr2GradeResetSettings`).
