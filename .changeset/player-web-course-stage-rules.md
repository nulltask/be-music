---
'@be-music/player-web': minor
---

Breaking: the course stage rules moved to `@be-music/player/course` and are no longer exported from `@be-music/player-web/collection`: `resolveCourseStageSettings`, `resolveCourseLaneOptions`, `isCourseHiSpeedLocked`, `isLr2GradeCourse`, `resolveLr2GradeCoursePlaySettings` and the types `CourseLaneOption`, `CourseLaneOptions` and `Lr2GradeResetSettings`. Migration: import them from `@be-music/player/course`; the names and signatures are unchanged.
