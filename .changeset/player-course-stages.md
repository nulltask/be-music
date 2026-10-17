---
'@be-music/player': minor
---

Add course-stage play: `PlayerOptions.course` runs a chart as one stage of a course.

- The stage plays on the ruleset's course gauge: LR2's grade and course gauges by course kind, and beatoraja's class gauges (`CLASS` / `EXCLASS` / `EXHARDCLASS`) per gauge set for beatoraja and IIDX.
- It starts from the gauge value and course-wide combo the previous stage left.
- It applies the course's `no_good` / `no_great` judge constraint.
- The play log records `play.course`, and the result reports the course combo, so a stage log replays and re-simulates on its own.
- `checkPlaylogEligibility` rejects course stages as `course-stage`.
