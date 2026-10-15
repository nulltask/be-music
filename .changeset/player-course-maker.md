---
'@be-music/player': minor
---

Add LR2's course maker rules to `@be-music/player/course`, so a host can let the player make their own EXPERT, NONSTOP and GRADE courses and share them as `.lr2crs` files.

- `createCourseDraft`, `appendCourseDraftStage` (at most five songs, all in the first song's key mode) and `removeLastCourseDraftStage` build a course being made.
- `finishCourseDraft` turns it into a course shaped as `parseLr2CourseFile` reads one, with the default NONSTOP connection after stages 1-5.
- `buildLr2CourseHash` writes LR2's course hash, `withNonstopConnection` and `stepLr2NonstopConnection` edit a NONSTOP connection as LR2's buttons 240-248 do, and `serializeLr2CourseFile` writes courses as a `.lr2crs` file.
