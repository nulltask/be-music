---
'@be-music/player': minor
---

Add `@be-music/player/course`: one course model (`CourseDefinition`) for LR2 `.lr2crs` files, beatoraja `course/*.json` files and the `course` / legacy `grade` lists of difficulty-table headers, with their parsers (`parseLr2CourseFile`, `parseBeatorajaCourseFile`, `parseTableHeaderCourses`, `parseBeatorajaRandomCourseData`), beatoraja's constraint and trophy normalisation, and `resolveCourseStages` to match each stage to a local chart by SHA-256 or MD5.
