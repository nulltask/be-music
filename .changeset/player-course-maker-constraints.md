---
'@be-music/player': minor
---

Let a made course carry beatoraja's constraints: `CourseDraft.constraints`, `defaultCourseMakerConstraints` (a GRADE course reads as an LR2 grade) and `withCourseConstraints`. Add `serializeBeatorajaCourseFile`, which writes a beatoraja `course/*.json` that keeps the constraints `.lr2crs` cannot hold, and `courseConstraintEnumName`.
