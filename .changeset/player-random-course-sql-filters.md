---
'@be-music/player': minor
---

Random-course SQL filters now follow beatoraja's query rules more closely. An unqualified column that beatoraja's joined `song` / `score` / `scorelog` / `information` tables share (`sha256`, `mode`, `notes`, `date`, `clear`, `combo`, `minbp`, `avgjudge`) is refused as ambiguous, as SQLite refuses it: a course tested with `mode = 7` used to draw in be-music and nothing in beatoraja (write `song.mode = 7`). A trailing `ORDER BY … LIMIT n [OFFSET m]`, which beatoraja accepts and its MY BEST folder uses, is no longer rejected: `parseCourseSongFilter` returns it as `query`, the new `selectCourseSongs` applies it (ties keep the candidates' order; `ORDER BY RANDOM()` reads the injected random source), and `drawRandomCourse` draws from what it leaves.
