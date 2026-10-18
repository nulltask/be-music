---
'@be-music/player-web': patch
---

A beatoraja play applied no lane option: RANDOM, MIRROR, S-RANDOM and SCATTER played the chart as written, and the play log recorded `play.randomLane` as `OFF`. `createPlayScene` with a beatoraja kit now plays the host's `random1P` / `random2P` as every family does, so the notes the skin draws and the engine judges are the arranged ones, and the play log records the options played.
