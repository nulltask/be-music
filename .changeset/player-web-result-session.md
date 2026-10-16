---
'@be-music/player-web': minor
---

Add `createResultScene(kit, options)` to `@be-music/player-web/scenes`, the result screen built on the scene session and family view contracts (ADR 0001). Its session plays the result's jingle from the theme's sounds (`resolveResultJingles`: the course jingles for a course run) through the audio service and stops it as the screen leaves the stage, steps the screen as LR2's result timers do (Enter, Space or a click skip the graphs, then show the record update, then continue; Escape continues at any time), and plays the chart again on R once input is open when the run offers a quick retry (`resolveResultPresentation`) and `on.retry` is given. The built-in family's view draws a be-music skin's `result` screen. The scene is a `SessionScene` to show with `PixiSceneHost.setScene`; `updateKit` hands it the player's new skin settings. `ResultFrame` gains `graphShownAtMs` and `updateShownAtMs`, the result's steps (LR2's timers 151 and 152).

`DefaultPixiResultView` and its `DefaultPixiResultViewOptions` type are removed; the built-in result screen is made with `createResultScene`. The LR2 result screen (`PixiResultView`, on `CoreResultView`) and the beatoraja one are unchanged. `CoreResultView`'s jingle still plays on a context of its own.

Migration:

- `new DefaultPixiResultView({ beMusicSkin, beMusicEffects, beMusicSkinSettings, collection, clearBgm, failBgm, resultBgm, onContinue, onRetry })`, then `view.setResult(result)` → `createResultScene({ family: 'built-in', skin: beMusicSkin, effects: beMusicEffects, settings: beMusicSkinSettings }, { result, run, source: resolveSongSource(collection, result.song), sounds, audio, on: { continue: onContinue, retry: onRetry } })`, where `audio` is the host's `createAudioService()`, `sounds` the theme's `SystemSoundSet` (its `clear`, `fail`, `result`, `courseClear` and `courseFail` slots), and `run` which play the result is of (`'single'`, `'stage'`, `'course'` or `'nonstop'`) when `result.run` does not say.
- `view.setBeMusicSkinSettings(settings)` → `scene.updateKit({ ...kit, settings })`.
- R only retries when the run offers a quick retry (`resolveResultPresentation(run).quickRetry`: a single play or a NONSTOP run) as well as `on.retry` being given.
