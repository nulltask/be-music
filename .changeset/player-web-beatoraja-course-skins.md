---
'@be-music/player-web': minor
---

Show courses on beatoraja skins: the select scene lights a course bar's constraint ops and names its stages on strings 150-159; the gameplay and result scenes take a `courseInfo` that lights `MODE_COURSE` and the stage ops, and on the course result reads the course title on the title strings; the gameplay scene's `hiSpeedLocked` holds the hi-speed for a `no_speed` course. Theme BGM discovery now finds `course_clear` / `course_fail` (`BeatorajaThemeBgm.courseClear` / `courseFail`, `pickBeatorajaThemeBgmPaths`), and an exact file name now wins over a loose match, so `course_clear.wav` or `resultclose.wav` no longer stands in for `clear.wav` / `result.wav`.
