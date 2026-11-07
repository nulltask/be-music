---
'@be-music/player-browser': minor
---

Give Synesthesia a decide screen, and stop taking FREE ZONE notes for long notes.

- Give the built-in Synesthesia skin a decide screen: the launch warp the select screen starts carries on into it, the title finishes zooming in under its lock-on reticle with the genre, mode, difficulty, level, banner and stage file, and the screen falls to black for the play. Picking a chart used to skip straight from the warp to the play.
- Add `SelectScene.launching()`, true while the select screen plays its launch outro, and the select screen's `on.launch` event, fired as a chart's outro begins, so a host can make way for the decide screen and start loading the play from the moment a chart is picked. `createDecideScene` takes `resolved`, a chart whose `#RANDOM` branches the host drew already.
- FREE ZONE notes (channel `17` / `27`) are no longer taken for long notes: an LR2 play skin no longer lights the chart's LN op for them, and beatoraja's song information leaves them out of its LN feature, note counts and densities, as beatoraja drops FREE ZONE.
