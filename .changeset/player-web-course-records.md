---
'@be-music/player-web': minor
---

Course bars show the player's course records: the select scenes take `resolveCourseRecord` (LR2 / default) and `resolveCourseLampOp` (beatoraja). LR2 skins light the focused bar's lamp ops (100-105) and draw `#SRC_BAR_LAMP` on course bars and, from `resolveSongRecord`, on song bars, which drew no lamp before; beatoraja skins light a course bar's `CLEAR_LAMP_*` op; the built-in skins' course card names the best lamp and trophy (`frame.courseRecord`).
