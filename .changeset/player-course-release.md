---
'@be-music/player': minor
---

Keep beatoraja's `release: false` in the course play log (`course.release`) and refuse such runs in `checkCoursePlaylogEligibility` as `unreleased`, as beatoraja keeps them off IR. A drawn random course is unreleased too. Before, the flag was dropped and those runs were ranked.
