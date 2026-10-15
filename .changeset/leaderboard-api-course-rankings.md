---
'@be-music/leaderboard-api': minor
---

Rank course runs. `POST /api/v0/course-scores` takes a gzipped course play log with each played stage's fingerprint documents: every stage is checked like a single play (a course stage is expected here, not refused), the run is re-simulated under lr2, beatoraja and iidx, each stage's carry-in must equal what the re-simulated previous stage left, and a run given up before its last stage is refused as `aborted`. Courses are keyed by their course fingerprint (kind, constraints and stage charts), so the same course from any source shares one board; course runs create no chart scores.

- New tables `course`, `course_score`, `course_score_result` and `course_best_score` (migration `0009_course_rankings`), with beatoraja-style course bests and course play logs in R2.
- `GET /api/v0/courses/:courseFingerprint`, `/courses/:courseFingerprint/leaderboard`, `/courses/:courseFingerprint/leaderboard/me` and `/course-scores/:id`, in the OpenAPI document.
- Linking an anonymous account moves its course runs too.
