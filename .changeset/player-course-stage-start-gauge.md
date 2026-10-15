---
'@be-music/player': minor
---

Add `resolveCourseStageStartGauge` to `@be-music/player/playlog`: the course gauge a course stage starts on (its ruleset id such as `GRADE` / `COURSE-EASY` / `CLASS`, range, border) and the value carried in from the previous stage, before the engine runs, so a host can show the course gauge from the stage's READY phase instead of the single-chart one.
