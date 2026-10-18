---
'@be-music/beatoraja-skin': patch
---

Fix two play-skin readings:

- 48 KEY 2P lane timers past key 9 (bombs, key beams, holds) lit the 1P lanes: the 2P side now uses its own bank 100 above the 1P one, as upstream `SkinPropertyMapper` does (2P key 10 = `1110`, the 2P wheel `1125` / `1126`).
- A course gauge read "NORMAL GAUGE" and drew the groove gauge: `beatorajaGaugeModeFromString` now maps `CLASS` / `EXCLASS` / `EXHARDCLASS` and LR2's course gauges (`GRADE`, `COURSE`, `COURSE-EASY` → `CLASS`; `-HARD` → `EXCLASS`; `-DEATH` → `EXHARDCLASS`) onto beatoraja's class gauges.
