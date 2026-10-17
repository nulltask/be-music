---
'@be-music/player-web': patch
---

Picking a course with a stage missing from the collection gave no reason why nothing started: the select scenes dropped it before telling the host. The core, LR2 and beatoraja select scenes now hand it to `onCourseSelected` / `onCoursePicked` too (beatoraja still plays its cancel cue), so the host can refuse it and say which stages are missing.
