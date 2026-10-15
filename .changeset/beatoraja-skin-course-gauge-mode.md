---
'@be-music/beatoraja-skin': patch
---

A course stage on a beatoraja play skin read "NORMAL GAUGE" and drew the groove gauge while the value was the course gauge's: `beatorajaGaugeModeFromString` sent every course gauge id to `NORMAL`. It now maps `CLASS` / `EXCLASS` / `EXHARDCLASS` and LR2's course gauges (`GRADE`, `COURSE`, `COURSE-EASY` → `CLASS`; `-HARD` → `EXCLASS`; `-DEATH` → `EXHARDCLASS`) onto beatoraja's class gauges.
