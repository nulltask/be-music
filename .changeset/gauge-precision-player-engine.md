---
'@be-music/player-engine': patch
---

beatoraja's gauges now run in single precision, as Java `float` does: the table, its TOTAL, LIMIT_INCREMENT and MODIFY_DAMAGE scaling, each delta and each sum round to float32, so a gauge near a border clears or fails as in beatoraja. LR2's per-note GROOVE and EASY gain is divided in float32 (`total / (float)notes`) while HP stays double.
