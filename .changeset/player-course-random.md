---
'@be-music/player': minor
---

Draw beatoraja random courses: `parseCourseSongFilter` / `evaluateCourseSongFilter` read the SQL `WHERE` subset random-course stages are written in (comparisons, `AND` / `OR` / `NOT`, `IN`, `LIKE`, `BETWEEN`, `IS NULL`, arithmetic) against a neutral `CourseSongRecord` with SQLite's comparison rules, failing closed on anything else, and `drawRandomCourse` draws one chart per stage with an injected `random` (beatoraja's `distinct` rule included) into a fixed `CourseDefinition`. `parseBeatorajaCommandFolderFile` reads the random courses of beatoraja's `folder/default.json`, and random-course stages now keep their `title`.
