---
'@be-music/player-web': minor
---

Add `createPlayScene(kit, options)` to `@be-music/player-web/scenes`, the play screen built on the scene session and family view contracts (ADR 0001). A play session (`PlaySession`) holds the play's behaviour around one scene-model `PlayState`: the chart and its lane options, the media (opened through the host's audio service, `openPlayGraph`), the engine, the play's own keys and touch lanes, the hi-speed, covers and play-log view, and the ending. The built-in family's view draws the shared playfield through a `PlayfieldSkin` and a be-music skin's chrome around it. The scene is a `SessionScene` to load with `prepare(onProgress)` (off stage, behind a decide screen), show with `PixiSceneHost.setScene` and begin with `start()`; it also has `requestExit`, `requestTogglePause`, the tempo and hi-speed setters, `recording`, `progress()` (the result so far), `waitForPlaylog`, `updateKit` and the audio and drawing knobs, and disposes with `{ preserveAudioTail }`. `preResolved` plays the `#RANDOM` branches the decide screen drew (`DecideScene.resolved`); the LR2 gameplay scene takes the same option. `PlayFrame` gains `shown` and `playfield` (the running play the shared playfield reads).

`DefaultPixiGameplayView` and its `DefaultPixiGameplayViewOptions` type are removed; the built-in play screen is made with `createPlayScene`. The LR2 play screen (`PixiGameplayView`, on `CoreGameplayView`) and the beatoraja one are unchanged.

Migration:

- `new DefaultPixiGameplayView({ beMusicSkin, beMusicEffects, beMusicSkinSettings, layoutMode, onExit, onRestart, onChartFinished, onHiSpeedChange, onTempoChange, replay, course, courseInfo, ...settings })`, then `view.prepare(host, song, source)` → `createPlayScene({ family: 'built-in', skin: beMusicSkin, effects: beMusicEffects, settings: beMusicSkinSettings }, { chart: song, source, settings: { layoutMode, ...settings }, replay, course: { stage: course, view: courseInfo }, audio, host, on: { exit: onExit, restart: onRestart, finish: (result) => onChartFinished(result), hiSpeed: onHiSpeedChange, tempo: onTempoChange } })`, then `scene.prepare()`, where `audio` is the host's `createAudioService()`.
- `view.getResultData()` → `scene.progress()`; `view.setBeMusicSkinSettings(settings)` → `scene.updateKit({ ...kit, settings })`.
- `view.startRecording()` / `stopRecording()` / `isRecording()` → `scene.recording.startRecording()` / `stopRecording()` / `isRecording()`.
