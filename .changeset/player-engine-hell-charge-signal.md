---
'@be-music/player-engine': minor
---

A hell charge note (an HCN, a hell-charge back-spin scratch included) now reports its gauge ticks to the UI: the judge core sends a `hell-charge` command (`channel`, the head's `beat`, `state`: `'gaining'` / `'draining'` / `'passed'`) each time the note switches between filling and emptying the gauge, and once its tail has passed. A replay sends the same commands as the play it records, and a replay seek announces the notes passing the judge line again. The `PlayerUIHellChargeState` type is exported from `./signals`.
