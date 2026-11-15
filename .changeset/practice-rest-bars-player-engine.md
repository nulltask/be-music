---
'@be-music/player-engine': minor
---

A PRACTICE play can now rest more or fewer bars around its range. `PlayPractice.restBarsBefore` and `restBarsAfter` (each absent is 1, as before; 0 starts and ends at the range itself) set how many whole bars `resolvePracticePlayWindow` adds before the first bar picked and after the last.
