---
'@be-music/player': minor
---

Add course identity and eligibility to `@be-music/player/playlog`, so a course run can be ranked on the Leaderboard.

- `computeCourseFingerprint` keys a course as `bmcourse0:<sha256>` over its kind, its normalized and sorted constraints and its stages' chart fingerprints in order, so the same course from a `.lr2crs`, a beatoraja course file or a table shares one key. `computeCoursePlaylogFingerprint` and `resolveCourseStageChartFingerprints` read it from a course play log.
- An unreached stage of a course play log can carry its `chartFingerprint` (optional, parsed and written), so a failed run is keyed too.
- `checkCoursePlaylogEligibility` is the course counterpart of `checkPlaylogEligibility`: every played stage passes the single-play check as a stage of this course, and the stages' assists flag the run.
