---
'@be-music/player-web': minor
---

Fix PLAY and AUTO doing nothing on a course bar in the built-in skins, which also showed "No chart selected" there: the select scene hands skins the focused course, PLAY starts it, and AUTO starts it through the new `onCourseAutoPlay` (every stage plays itself). The built-in skins show the course's name, kind, stage count and stages.
