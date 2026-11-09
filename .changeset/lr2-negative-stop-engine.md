---
'@be-music/player-engine': patch
---

NONSTOP stitching writes no `#STOP` for a stage's negative `#STOPxx`: the time LR2 takes back for it is already in the stitched note times.
