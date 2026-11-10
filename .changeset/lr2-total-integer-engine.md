---
'@be-music/player-engine': patch
---

Fix LR2 gauges running on a fractional TOTAL: under LR2 rules `#TOTAL` and the default TOTAL are truncated to an integer and a value below 1 takes the default, as LR2 keeps TOTAL in an int, so a GROOVE or EASY result near the 80% border matches LR2.
