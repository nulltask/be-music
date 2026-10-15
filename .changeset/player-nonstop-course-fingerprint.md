---
'@be-music/player': patch
---

A NONSTOP course's fingerprint now includes its connections between the stages and its placement mode, so two NONSTOP courses of the same charts joined or placed differently no longer share a leaderboard. `computeCourseFingerprint` takes them as `nonstop`, and `computeCoursePlaylogFingerprint` reads them from the course play log.
