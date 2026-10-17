---
'@be-music/player-web': minor
---

`createPlayScene` takes a beatoraja kit (`{ family: 'beatoraja', kit }`, a theme's play entry loaded with `loadBeatorajaSceneKit`): the play session drawn by the beatoraja family view, so every family's play screen is made with it. The view draws the play skin through `BeatorajaPlaySkinView` with its note, marker and BGA layers, reads the skin's ops, numbers, texts, gauge and graphs off the frame's `PlayState` and the engine's latest frame through the scene mapping of `@be-music/beatoraja-skin/scene`, and starts the skin's timers from the frame's moments. The session times the play from load-end (READY, PLAY and STARTINPUT then, the chart 1.5 s later) and fades a leaving play over the skin's `fadeout`. A beatoraja play keeps the old screen's settings: no lane options and no HS-FIX, the lane covers starting at 0, and beatoraja's cover keys (PageUp / PageDown, Home / End, H / J / K), the wheel and the skin's cover buttons. It now gets the session's ESC fade-out, F5 restart, Space pause and auto-pause, and plays the skin's Lua sounds through the audio service's skin sounds, owned by the play.

New with it:

- `PlayScene.resolved`: the chart as the play plays it, with its `#RANDOM` draws, for the result's graphs.
- `PlaySceneSettings.coverStart` (`'play-options'` or `'none'`) and `coverKeys`: where the lane covers start, and whether the play takes the cover keys.
- `PlayViewEvent`: a judgment carries the running `combo`, and a `view-setting` event (`PlayViewSetting`) says the player's keys changed the hi-speed or a lane cover.
- `BeatorajaNoteLayer.update` takes a `BeatorajaNoteClock` (the notes, chart time and beat; an engine frame still fits), and `BeatorajaBgaLayer.resume()` plays a video the pause stopped again.

`PixiBeatorajaGameplayView` and `PixiBeatorajaGameplayViewOptions` (`/scenes`), `BeatorajaRuntimeAdapter` and `BeatorajaRuntimeAdapterOptions` (`/skin`), and `prepareBeatorajaGameplayChart`, `PrepareBeatorajaGameplayChartOptions` and `PreparedBeatorajaGameplayChart` (`/chart`) are removed. The play session prepares the chart and its media for every family, its `PlayState` holds what the adapter kept (the lane covers, the score and gauge histories, the early / late counts), and the rest of the adapter is part of the beatoraja play view.

Migration:

- `prepareBeatorajaGameplayChart({ song, source, ... })`, then `new PixiBeatorajaGameplayView({ skin, textures, fonts, skinConfig, variant, chart, sourceChart, audio, mode, dpFlip, engineOptions, bgaTextures, bgaVideoElements, chartImages, bgaCues, skinAudio, initialHiSpeed, courseInfo, onExit, onComplete, onHiSpeedChange })` → `createPlayScene({ family: 'beatoraja', kit }, { chart: song, source, settings, course: { stage, view: courseInfo }, preResolved, audio, host, on: { exit: onExit, finish, restart, hiSpeed: onHiSpeedChange } })`, then `scene.prepare()`, where:
  - `kit` is `loadBeatorajaSceneKit`'s for the chart's variant;
  - `settings` carries what went into `mode`, `dpFlip`, `initialHiSpeed` and `engineOptions` (`autoPlay`, `dpFlip`, `initialHiSpeed`, the tempo, the judge ruleset and the gauge);
  - `audio` is the host's `createAudioService()` with the theme's files set (`audio.setTheme({ files })`) for the skin's Lua sounds;
  - the scene loads the chart's samples, BGA and `#STAGEFILE` / `#BACKBMP` / `#BANNER` itself.
- `onComplete(summary, maxCombo, history)` → `on.finish(result, playlog)`: `result` is the `PixiGameplayResultData` with the judgments, the score and gauge histories and the timings. `view.getPlaylog()` → the `playlog` of `on.finish`, or `scene.waitForPlaylog()` after an exit; `view.awaitCompletion()` → `on.finish` / `on.exit`.
- `view.replaceSkin(...)` → `scene.updateKit({ family: 'beatoraja', kit })`; `view.startRecording()` / `stopRecording()` / `isRecording()` → `scene.recording.startRecording()` / `stopRecording()` / `isRecording()`.
