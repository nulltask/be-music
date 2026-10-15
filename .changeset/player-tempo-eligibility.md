---
'@be-music/player': minor
---

`checkPlaylogEligibility` refuses a play at another tempo (`play.tempo` other than 1) with the new reason `tempo`, and `checkCoursePlaylogEligibility` refuses a course run with such a stage the same way: a tempo-changed play is practice and is not ranked, as beatoraja's frequency trainer does not save its scores.
