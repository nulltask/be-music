---
'@be-music/player-web': minor
---

Add the audio service, `createAudioService` (`./audio`), and play every scene through it, where each screen used to open an `AudioContext` of its own. The select BGM, cues, jingles, chart preview and beatoraja skin sounds play on one lazily created system `AudioContext` behind the master volume (ADR 0007), each sound is decoded once per bytes, and every sound can carry an owner so a scene stops what it started as it leaves (`stopOwned`). `openPlayGraph` opens a play's own context and audio bus, `skinSounds` plays a beatoraja skin's Lua sounds from the theme's files (`setTheme({ files })`), and `playBGM`, `playJingle` and `playCue` take a slot of the theme's sounds or a resolved `SystemSound`.

Add the platform audio session helpers, so a host can let web audio play while an iPhone or iPad is in silent mode. iOS Safari treats web audio as ambient sound that the Ring / Silent switch mutes; `applySilentModePlayback(true)` sets `navigator.audioSession.type` to `'playback'` (audible in silent mode, pauses other apps' audio) and `applySilentModePlayback(false)` restores the browser default `'auto'`. `supportsSystemAudioSession`, `getSystemAudioSession`, `applySystemAudioSessionType` and `resolveSilentModeAudioSessionType` cover feature detection and other types. Each helper is a no-op where the Audio Session API is missing and swallows errors.

`BeatorajaSkinAudioPlayer` and `BeatorajaSkinAudioPlayerOptions` are removed from `./skin`: they played a beatoraja skin's Lua sounds on an `AudioContext` of their own, one per theme. The `BeatorajaSkinAudio` interface stays.

Migration:

- `new BeatorajaSkinAudioPlayer({ files })` → `audio.setTheme({ files })` on the service from `createAudioService()`, then hand `audio.skinSounds.owned(owner)` wherever a `BeatorajaSkinAudio` is taken, such as `createBeatorajaSkinLoadContext`'s `skinAudio`.
- `player.dispose()` when a new theme replaces the old one → `audio.stopOwned(owner)`, which stops the loops that owner started.
