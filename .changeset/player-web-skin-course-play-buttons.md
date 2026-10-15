---
'@be-music/player-web': patch
---

An LR2 skin's PLAY / AUTOPLAY buttons (button types 15 / 16) and a beatoraja skin's PLAY / AUTO PLAY (acts 15 / 16) did nothing on a course bar: they only looked for a focused song. They now start the focused course through `onCourseSelected` / `onCourseAutoPlay` (LR2) and `onCoursePicked`, which takes `{ autoPlay: true }` for AUTO PLAY (beatoraja).
