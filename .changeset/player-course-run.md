---
'@be-music/player': minor
---

Add `CourseRun` to `@be-music/player/course`: one run of an EXPERT or GRADE course, moved out of the web demo so every host plays courses by the same rules. It plans each stage (its chart with the course's long-note constraint, `PlayerOptions.course` with the state the previous stage left, the hi-speed lock), records the stage play logs and a stage given up with ESC, ends the run on a failed or last stage, adds up the play time and builds the course play log. Its stage entries are the host's own (anything with a `chart` and a `chartPath`).

- `resolveCourseStagePlaySettings` gives the settings a stage plays with in place of the player's picks: the lane options the course allows, then an LR2 GRADE course's resets.
- `resolveGivenUpPlaySeconds` gives the play time of a stage given up with ESC.
