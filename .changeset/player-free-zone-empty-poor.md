---
'@be-music/player': patch
---

Fix scratch presses during a FREE ZONE never charging an empty POOR in live play while play-log re-simulations did: no reference gives FREE ZONE a judging effect (LR2 and beatoraja drop channels 17 / 27 from 7-key and 14-key charts, and IIDX never had FREE ZONE), so such a press is now judged as any other. Its keysound still plays.
