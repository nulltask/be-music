---
'@be-music/player': patch
---

Fix a charge note (CN / HCN) held past its tail's late window scoring a BAD instead of a missed POOR: when the window closed on a replay step that landed exactly on its edge, the engine judged the tail as if it had been released there. A tail that is never let go is now a POOR, as in beatoraja and the play-log simulator.
