---
'@be-music/player-web': minor
---

`createPlayScene(kit, options)` takes an LR2 play kit (`{ family: 'lr2', skin, invisibleNoteSkin? }`): the play session drawn by the LR2 family view. The view reads the skin's ops, numbers, texts, sliders and bar graphs off the frame's `PlayState` through `resolveLr2PlayState`, starts and stops the skin's timers from the play's moments through `resolveLr2PlayTimers`, and answers the shared playfield through a `PlayfieldSkin` (the skin's lane rects, note cells, measure lines, BGA rects, and its bomb and key-beam spans). The session times the play from the skin's `#LOADSTART` / `#LOADEND` / `#PLAYSTART` / `#FADEOUT` / `#CLOSE`. The LR2 play screen draws and plays as before. `PlayViewEvent`'s gauge event gains `atMs`, the play-clock time of the move.

`PixiGameplayView` and its `PixiGameplayViewOptions` type are removed, with the LR2 gameplay scene's base `CoreGameplayView`; the LR2 play screen is made with `createPlayScene`. `PixiGameplayResultData`, `GaugeHistorySample` and `ScoreHistorySample` are still exported from `@be-music/player-web/scenes`.

Migration:

- `new PixiGameplayView({ skin, invisibleNoteSkin, onExit, onRestart, onChartFinished, onHiSpeedChange, onTempoChange, replay, course, courseInfo, preResolved, ...settings })`, then `view.prepare(host, song, source)` → `createPlayScene({ family: 'lr2', skin, invisibleNoteSkin }, { chart: song, source, settings, replay, course: { stage: course, view: courseInfo }, preResolved, audio, host, on: { exit: onExit, restart: onRestart, finish: (result) => onChartFinished(result), hiSpeed: onHiSpeedChange, tempo: onTempoChange } })`, then `scene.prepare()`, where `audio` is the host's `createAudioService()`.
- `view.getResultData()` → `scene.progress()`; `view.startRecording()` / `stopRecording()` / `isRecording()` → `scene.recording.startRecording()` / `stopRecording()` / `isRecording()`.
- `view.setBeMusicSkinSettings(settings)` had no effect on an LR2 play; an LR2 play scene ignores `updateKit` with a built-in kit.
