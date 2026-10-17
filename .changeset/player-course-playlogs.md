---
'@be-music/player': minor
---

Add course play logs to `@be-music/player/playlog`. A course run is one `be-music-course-playlog` file that holds each stage's own play log, plus the chart facts of any stage the run never reached.

- `createCoursePlaylog` assembles the file and caches the engine's course result.
- `simulateCoursePlaylog` re-derives the course result stage by stage from the simulated carry-over. It returns the summed judgments, BP including unjudged notes, the course max combo, the course lamp and the trophy.
- `extractCourseStage` returns one stage as a standalone single-chart log.
- `parseCoursePlaylog` / `serializeCoursePlaylog` read and write the file.
- `aggregateCourseResult`, `resolveCourseLamp` and `resolveCourseTrophy` are exported for hosts.
