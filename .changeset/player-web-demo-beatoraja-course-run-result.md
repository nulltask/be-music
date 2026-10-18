---
'@be-music/player-web-demo': patch
---

The course result on a beatoraja theme read the run through a beatoraja-only summary: its score read the EX score under every ruleset, its lamp was worked out again from the gauge, it had no play time and it named the first stage's chart. It now reads the same `PlayResult` as the LR2 and built-in course results (`playResultFromCourseRun`): the course's own lamp, the score on the stage results' scale (LR2's money score under the LR2 ruleset), the stages' play time and the course's name, with every stage's graph joined as before. `buildCourseResultSummary` is removed.
