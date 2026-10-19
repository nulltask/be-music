---
'@be-music/player': minor
---

Add LR2's course maker rules to `@be-music/player/course`, so a host can let the player make their own EXPERT, NONSTOP and GRADE courses and share them:

- `createCourseDraft`, `appendCourseDraftStage` (at most five songs, all in the first song's key mode) and `removeLastCourseDraftStage` build a course being made; each `CourseDraftStage` carries its song's `subtitle` for the host to show.
- `finishCourseDraft` turns it into a course shaped as `parseLR2CourseFile` reads one, with the default NONSTOP connection after stages 1-5.
- `buildLR2CourseHash` writes LR2's course hash, `withNonstopConnection` and `stepLR2NonstopConnection` edit a NONSTOP connection as LR2's buttons 240-248 do, and `serializeLR2CourseFile` writes courses as a `.lr2crs` file.
- A made course can carry beatoraja's constraints (`CourseDraft.constraints`, `defaultCourseMakerConstraints`, where a GRADE course reads as an LR2 grade, and `withCourseConstraints`), and `serializeBeatorajaCourseFile` writes a beatoraja `course/*.json` that keeps the constraints `.lr2crs` cannot hold, with `courseConstraintEnumName`.
