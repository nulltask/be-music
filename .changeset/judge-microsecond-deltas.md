---
'@be-music/player': patch
---

Fix a press landing exactly on a judge window edge sometimes taking the next worse judgment in live play: the engine now compares whole-microsecond timing deltas against the windows, as the play-log simulator does, instead of a float difference that could fall a hair outside the edge.
