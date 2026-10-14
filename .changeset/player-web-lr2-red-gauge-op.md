---
'@be-music/player-web': patch
---

Fix LR2 play skins never showing the red gauge frame on HARD / DEATH runs: the scene set the red gauge op (43) at the start of the play, but its per-frame gauge refresh re-added the normal gauge op (42) and cleared 43, so elements gated on `#IF op43` stayed hidden and those gated on `#IF op42` showed instead. The per-frame refresh now only updates the gauge-percentage ops (230–240) and leaves the gauge-type ops chosen for the run alone.
