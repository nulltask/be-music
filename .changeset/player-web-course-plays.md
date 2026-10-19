---
'@be-music/player-web': minor
---

Play course stages and show course results on every family. `createPlayScene`'s `course` takes the stage's rules with what the previous stage carried in (`stage`, a `PlaylogCourseStage`) and the course as a skin shows it (`view`, a `CourseView` from `@be-music/scene-model`), and `createDecideScene` takes the course to name it. A stage shows its course gauge at the carried-in value from its READY phase, so the HUD, LR2's gauge ops and the gauge graph start there. A `no_speed` course locks the hi-speed (`hiSpeedLocked`), and on beatoraja skins the lane cover, the lift and the HIDDEN cover too. A result with `run: 'course'` is a course result.

- LR2 skins light the course ops (290-293, and 280-289 for the stage), and in an EXPERT or GRADE course count numbers 104 / 105 and the combo next to the judgement (`#DST_NOWCOMBO`) over the whole course, as LR2 draws `now_combo_course`.
- beatoraja skins light `MODE_COURSE` and the stage ops, read the course title on the title strings of a course result, and play the theme's `course_clear` / `course_fail` jingles (`BeatorajaThemeBgm.courseClear` / `courseFail`).
- The built-in result skins head a course result `COURSE CLEAR` / `COURSE FAILED` and label the gauge graph with the gauge the play ran on, and Synesthesia's play HUD fits long gauge labels such as `COURSE-EASY GAUGE`.
