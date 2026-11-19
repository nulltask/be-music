---
'@be-music/player-engine': minor
---

A course stage given up with ESC now follows the course gauge's source, as the stage failure rule does: LR2's course gauges go on to the next stage while the gauge is at 2 % or more and the stage judged a GOOD or better, as `LR2body.exe` does, and the course lamp is FAILED in the end; beatoraja's class gauges (and the `____` courses that run on them) and plugout end the run, as before. Before, every gauge ended the run, which LR2 does not.

- `courseGoesOnAfterGivingUp` (from `@be-music/player-engine/course`) states the rule.
- `CourseRun.giveUp` returns `'next'` or `'finished'`, and `CourseRun.goesOnAfterGivingUp` asks before recording; an endless run always ends on a stage given up.
- `simulateCourseReplay` stops at a stage given up where the target's course gauge ends the run, and `rejudgeCourseReplay` marks a run that ended on one `truncated` under a ruleset whose course gauge goes on.
- A course on LR2's course gauge under another judge ruleset is FAILED when a stage in it was given up, as it is under LR2's own.
