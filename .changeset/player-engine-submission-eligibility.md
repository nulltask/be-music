---
'@be-music/player-engine': minor
---

`checkReplayEligibility` and `checkCourseReplayEligibility` accept every play except a fully AUTO one and a log without fingerprints, and the Leaderboard decides what it shows (#788). A single play given up with ESC is eligible (a course run still is not when it gave up on any stage but the last one played), and a play at another tempo, a course stage sent on its own or a run of an unreleased course is accepted with the reason it does not rank in `unranked` (`ReplayUnrankedReason`, `CourseReplayUnrankedReason`). `ReplayIneligibleReason` drops `aborted`, `tempo` and `course-stage`, and `CourseReplayIneligibleReason` drops `tempo` and `unreleased`.
