---
'@be-music/player': patch
---

An ESC-aborted AUTO play recorded the play clock's time of the ESC as `play.abortedAtUs`, which can run up to a frame past what its judge had settled: AUTO play now records the chart time its judge had settled through, as manual play does and as the play-log specification says. A replay's ESC records the chart time its replay had been driven through.
