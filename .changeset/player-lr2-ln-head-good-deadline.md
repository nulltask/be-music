---
'@be-music/player': patch
---

Fix an unpressed LN head under the LR2 ruleset being missed only after its late BAD window closed: LR2 has no late BAD on an LN head and misses it once time moves past the late GOOD leg (OpenLR2 `ProcLongnote`). Both the engine and the play-log simulator now miss it there, and the simulator no longer skips such a miss when a plain note just ahead of it on the same lane still has time left.
