---
'@be-music/player-engine': minor
---

Add `parseN2XCourseFile`, which reads a Nanasi Groove 2 chart list (`.n2x`, the `bmslist` Toy Musical 3 ships beside its charts) as an EXPERT course of its charts in order, without the unlock conditions. Its stages name their charts by the new `CourseStageRef.path` until a host binds them to the charts' hashes, and the course's source is `{ format: 'n2x' }`.
