---
'@be-music/player': minor
---

Record NONSTOP course runs: a course play log can hold the stitched play (`BeMusicCoursePlaylog.nonstop`, `PlaylogNonstopRun`) that `simulateCoursePlaylog` takes the course result from, while `splitNonstopPlaylog` cuts each reached stage out of it as a self-contained stage log (its notes timed from the stage's own zero, the inputs that played them, and the state it started from) so `extractCourseStage` keeps working; `resolveNonstopNoteStages` and `resolveNonstopPlaylogStages` read the stage layout from the stitched chart. `play.course.rate` records a stage's FIT stretch, and `checkCoursePlaylogEligibility` refuses NONSTOP runs (`nonstop`) until the Leaderboard can verify them.
