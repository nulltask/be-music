---
'@be-music/player-web': minor
---

Add a Master Tempo mode for NONSTOP FIT stages: with the gameplay scene's `nonstopFitMode: 'master-tempo'`, a FIT stage's samples are time-stretched to the previous stage's tempo when they load (WSOLA) and keep their pitch, as a CDJ's Master Tempo does. The default, `'pitch'`, plays them faster or slower as LR2 does.
