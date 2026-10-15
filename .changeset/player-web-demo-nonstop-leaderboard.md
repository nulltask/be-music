---
'@be-music/player-web-demo': minor
---

Submit NONSTOP course runs to the Leaderboard too, given up with ESC or not: the course play log names each stage's chart and records the `#RANDOM` draws each stage was resolved with, and the submission sends every stage chart so the server can stitch them again. Course submissions also send the chart of each stage a failed run never reached, which the server now needs to check the notes they count as BP. A NONSTOP course's lane-option constraint (`grade`, `grade_mirror`, ...) now applies to its stitched play, as it does to the stages of other courses.
