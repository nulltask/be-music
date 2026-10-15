---
'@be-music/player': minor
---

Add course identity and eligibility to `@be-music/player/playlog`, so a course run can be ranked on the Leaderboard.

- `computeCourseFingerprint` keys a course as `bmcourse0:<sha256>`, built like the chart fingerprint: `createCourseFingerprintDocument` returns a canonical, versioned document (`v: 'bmcourse0'`) of the course's kind, its normalized and sorted constraints and its stages' chart fingerprints in order, and the fingerprint hashes its RFC 8785 text. A NONSTOP course also lists its connection at each seam (an unnamed seam reads as `fade`, as the stitcher reads it) and its placement mode, since they decide the stitched chart. The same course from a `.lr2crs`, a beatoraja course file or a table shares one key. See `docs/fingerprint-spec.md` §8.
- `computeCoursePlaylogFingerprint` and `resolveCourseStageChartFingerprints` read it from a course play log; an unreached stage can carry its `chartFingerprint`, so a failed run is keyed too.
- `checkCoursePlaylogEligibility` is the course counterpart of `checkPlaylogEligibility`: every played stage passes the single-play check as a stage of this course, and the stages' assists flag the run.
