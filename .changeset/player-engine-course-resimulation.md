---
'@be-music/player-engine': patch
---

Re-simulating a course replay is about five times faster: `simulateCourseReplay` no longer deep-clones each stage's whole log to swap in its carry-in, and copies only the path down to `play.course` instead (`simulateReplay` never writes to the log it reads). The course log passed in stays untouched.
