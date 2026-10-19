---
'@be-music/player': patch
---

A course made with `finishCourseDraft` was ranked on the Leaderboard from the start (`release: true`). It now starts unranked (`release: false`), as LR2 inserts a made course with `ir = 0` and beatoraja's course editor starts a new course with `release = false`; `withNonstopConnection` keeps the flag. `.lr2crs` has no room for it, so `serializeLr2CourseFile` / `parseLr2CourseFile` still read every course back released.
