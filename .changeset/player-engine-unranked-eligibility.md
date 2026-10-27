---
'@be-music/player-engine': minor
---

`checkReplayEligibility` and `checkCourseReplayEligibility` no longer refuse a play at another tempo, a course stage or an unreleased course: they accept it and name why it does not rank in `unranked` (`ReplayUnrankedReason`, `CourseReplayUnrankedReason`), so every play except a fully AUTO one and a log without fingerprints can be submitted and the Leaderboard decides what it shows (#788). `ReplayIneligibleReason` and `CourseReplayIneligibleReason` drop `tempo`, `course-stage` and `unreleased`.
