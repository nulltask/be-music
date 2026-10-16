---
'@be-music/scene-model': minor
---

Add the play-side scene models, so every gameplay and result screen reads one implementation whatever skin family draws it:

- Play state: the running gauge and EX score with their graphs, the combo and a course stage's course combo, the timed judgments with each judgment's early / late count, the hi-speed under HS-FIX and the lane covers with LIFT and HIDDEN, as one immutable `PlayState` fed by the engine's frames and judgments through `reducePlayState` (`createPlayState`, `playEventFromUiCommand`, `recentJudgeTimings`, `createHiSpeedState`, `reduceHiSpeed`, `resolveHsFixMultiplier`, `laneCoversFromPlayOptions`, `reduceLaneCovers`, `resolveLaneCover`), and its view in the play log's units (`resolvePlaylogView`, `resolveWhiteNumber`, `resolveGreenNumber`, `PlaylogViewCursor`, `resolveBeatorajaPlaylogView`).
- Course view: `CourseView` / `resolveCourseView` and the course combo (`createCourseCombo`, `reduceCourseCombo`, `advanceCourseCombo`).

Where the built-in / LR2 and beatoraja scenes differed, the models follow LR2, and beatoraja for what LR2 does not have (HS-FIX, LIFT, cover adjustment during play, early / late counts); docs/scene-model.md lists each choice.
