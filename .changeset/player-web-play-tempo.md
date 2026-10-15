---
'@be-music/player-web': minor
---

Play a song at another tempo: the LR2 / default gameplay scenes take `tempo` (0.5 to 1.5, default 1) and run the play clock, the scheduled and triggered samples, the scroll, the BGA videos, the NONSTOP stage fades and the lead-out `tempo` times as fast, while the engine judges in chart time (`speed`). A replay plays at the tempo its log recorded. `tempoPitchMode` decides how it sounds, for the song tempo and NONSTOP FIT stages alike: `'pitch'` (default) moves the pitch, `'keep-pitch'` stretches the samples when they load (with `tempoStretchAlgorithm`) and keeps it; the two rates multiply on a FIT stage. `prepareBeatorajaGameplayChart` takes the same `tempo`, `tempoPitchMode` and `tempoStretchAlgorithm` and readies the beatoraja scene's audio and video BGA for it (the host passes `tempo` as `engineOptions.speed`).
