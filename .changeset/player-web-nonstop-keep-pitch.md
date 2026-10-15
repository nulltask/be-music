---
'@be-music/player-web': minor
---

Add a keep-pitch mode for NONSTOP FIT stages: with the gameplay scene's `tempoPitchMode: 'keep-pitch'`, a FIT stage's samples are time-stretched to the previous stage's tempo when they load and keep their pitch. The default, `'pitch'`, plays them faster or slower as LR2 does. `tempoStretchAlgorithm` picks the stretcher: `'signalsmith'` (default, Signalsmith Stretch, a new runtime dependency loaded only when used, falling back to WSOLA where it cannot run) or `'wsola'` (built in).
