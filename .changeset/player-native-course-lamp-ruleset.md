---
'@be-music/player': patch
---

A course play log's own result (`results.native`, from `createCoursePlaylog`) lamped the run under no judge ruleset, so it stopped at FULL COMBO under beatoraja, gave an LR2 DEATH clear HARD and an LR2 EASY pick NORMAL, unlike a re-simulation of the same run. It is now lamped under the judge ruleset the stages (or a NONSTOP run's stitched play) were played on, by the same course clear-lamp rule.
