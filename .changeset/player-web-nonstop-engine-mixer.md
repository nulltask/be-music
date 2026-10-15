---
'@be-music/player-web': patch
---

Fix a NONSTOP play's later stages drifting from their background music under a FIT connection: the stage mixer only reached the scene's own audio session, not the one the engine plays through, so a FIT stage's samples played at their original speed while its notes followed the previous stage's tempo, and the seam fades did not apply either.
