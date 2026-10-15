---
'@be-music/player-web': minor
---

Play courses in the web player.

- `readCourseFile`, `resolveCourseFolders` and `createSongHashLookup` read dropped LR2 / beatoraja course files and match their stages to the collection by hash.
- The core, LR2 and beatoraja select scenes list course folders and course bars and report the course started (`onCourseSelected` / `onCoursePicked`). LR2 skins use the course bar bodies, and beatoraja skins light `GRADEBAR` with the grade frame.
- The built-in skins show the course name and stage count.
- The gameplay view takes a course stage (`course`) and can lock the hi-speed (`hiSpeedLocked`).
- `resolveCourseStageSettings`, `resolveCourseLaneOption` and `applyCourseLongNoteConstraint` apply a course's constraints.
