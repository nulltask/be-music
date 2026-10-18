---
'@be-music/player-web': patch
---

A beatoraja play started with every lane cover off whatever the play options said, so a player who picked SUDDEN or HIDDEN had to set it again with the cover keys at every play. `createPlayScene` with a beatoraja kit now starts the covers from the host's `hiddenSudden1P` / `hiddenSudden2P`, `shutter` and `laneCover`, as every family does (no LIFT: the play options have none); the cover keys, the wheel and the skin's cover buttons move them from there.
