---
'@be-music/player-web': minor
---

Let the play tempo change during a play in `pitch` mode. The LR2 / default gameplay view gains `setTempo(tempo)`, `getTempo()` and an `onTempoChange` option, and the beatoraja gameplay view `setTempo(tempo)` and `getTempo()`: they push the engine's tempo command, and from the chart time the engine takes it the view's clock, the samples (started afterwards, and the ones playing gliding to the new rate through `WebAudioSession.setTempo`), bmson slices, the BGA videos and a NONSTOP chart's stage fades run at the new tempo. In `keep-pitch` mode the samples were stretched to the tempo they loaded at, so the views refuse a live change. A replay follows its log's tempo changes in `pitch` mode (`resolveReplayTempo`).
