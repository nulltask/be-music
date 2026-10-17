---
'@be-music/player-web': patch
---

Fix beatoraja play and result skins showing the displayed score on number 101 (`SCORE2`), the same as `POINT` (100) (#430): beatoraja's `IntegerPropertyFactory` reads 101 as the run's EX score, as LR2 does, and so do the play and result scenes now.
