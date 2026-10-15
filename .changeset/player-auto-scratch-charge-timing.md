---
'@be-music/player': patch
---

Fix AUTO SCRATCH scoring a charge note's head and tail together — at the tail in the engine and at the head in the play-log simulator — so a miss in between broke the combo differently: both now clear the head at the head and the tail at the tail, as beatoraja's autoplay does.
