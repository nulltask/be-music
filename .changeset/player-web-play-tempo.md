---
'@be-music/player-web': minor
---

Play a chart at another tempo. `createPlayScene`'s `tempo` setting (0.5 to 1.5, default 1) runs the play clock, the samples, the scroll, the BGA videos, a NONSTOP chart's stage fades and the lead-out that many times as fast, while the engine judges in chart time. `tempoPitchMode` decides how it sounds, for the play's tempo and a NONSTOP FIT stage alike (the two rates multiply): `'pitch'` (the default, as LR2) moves the pitch, and `'keep-pitch'` time-stretches the samples as they load and keeps it. `tempoStretchAlgorithm` picks the stretcher: `'signalsmith'` (the default; Signalsmith Stretch, a new runtime dependency loaded only when used, falling back to WSOLA where it cannot run) or `'wsola'` (built in). In pitch mode the tempo can change during a play with `PlayScene.setTempo()` (`getTempo()`, `on.tempo`), the playing samples gliding to the new rate. A replay plays at its log's tempo and follows its tempo changes.
