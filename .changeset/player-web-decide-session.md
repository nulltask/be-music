---
'@be-music/player-web': minor
---

Add `createDecideScene(kit, options)` to `@be-music/player-web/scenes`, the first screen built on the scene session and family view contracts (ADR 0001). Its session times the screen from the view's skin timing (input delay, auto advance, fade-out), continues on Enter, Space or a click once input is open, backs out on Escape, and plays the theme's decide jingle (`sounds.decideBgm`) through the audio service until the screen leaves the stage. The built-in family's view draws a be-music skin's `decide` screen. The scene is a `SessionScene` to show with `PixiSceneHost.setScene`; `updateKit` hands it the player's new skin settings.

`DefaultPixiDecideView` and its `DefaultPixiDecideViewOptions` and `DefaultPixiDecideTarget` types are removed; the built-in decide screen is made with `createDecideScene`. The LR2 and beatoraja decide screens are unchanged.

`SessionScene` no longer draws a frame once its session has ended the scene while making that frame, as a decide screen does when its time runs out and its host disposes it at once.

Migration:

- `new DefaultPixiDecideView({ beMusicSkin, beMusicEffects, beMusicSkinSettings, playOptions, onContinue, onCancel })`, then `view.setTarget({ song, collection })` → `createDecideScene({ family: 'built-in', skin: beMusicSkin, effects: beMusicEffects, settings: beMusicSkinSettings }, { chart: song, playOptions, source: resolveSongSource(collection, song), sounds, audio, on: { continue: onContinue, cancel: onCancel } })`, where `audio` is the host's `createAudioService()` and `sounds` its theme's `SystemSoundSet` (`{}` to play no jingle).
- `view.setBeMusicSkinSettings(settings)` → `scene.updateKit({ ...kit, settings })`.
- `view.durationMs` is gone: the scene moves on by itself after the skin's `decide.durationMs` and calls `on.continue`.
