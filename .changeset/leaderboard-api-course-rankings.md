---
'@be-music/leaderboard-api': minor
---

Rank course runs. `POST /api/v0/course-scores` takes a gzipped course play log with each played stage's fingerprint documents: every stage is checked like a single play (a course stage is expected here, not refused), the run is re-simulated under lr2, beatoraja and iidx, and each stage's carry-in must equal what the re-simulated previous stage left. Courses are keyed by their course fingerprint, so the same course from any source shares one board; course runs create no chart scores.

- A failed run is ranked too: its unreached stages are checked against their stage charts (`stageCharts`), and a run given up with ESC counts as a failed one, as LR2 records it.
- NONSTOP runs are ranked: the server stitches the stage charts again, by the stitching rules the log records (`nonstop.stitch`; unknown rules are refused as `nonstop-stitch-unsupported`), and checks the stitched play against them (`nonstop-chart-mismatch`, `nonstop-stage-mismatch`).
- A beatoraja course marked `release: false` is refused as `unreleased`.
- New tables `course`, `course_score`, `course_score_result` and `course_best_score` (migrations `0009`-`0011`), with beatoraja-style course bests, each run's stage figures and the best trophy, and course play logs in R2.
- `GET /api/v0/courses/:courseFingerprint`, `/courses/:courseFingerprint/leaderboard`, `/courses/:courseFingerprint/leaderboard/me` and `/course-scores/:id`, in the OpenAPI document. Linking an anonymous account moves its course runs too.
