---
'@be-music/player-web': minor
---

`BeatorajaSkinAudioPlayer` and its `BeatorajaSkinAudioPlayerOptions` type are removed from `./skin`. It played a beatoraja skin's Lua sounds (`main_state.audio_play` / `audio_loop` / `audio_stop`) on an `AudioContext` of its own, one per theme; the audio service plays them on the one system context (ADR 0007), as every beatoraja scene already did. The `BeatorajaSkinAudio` interface stays.

Migration:

- `new BeatorajaSkinAudioPlayer({ files })` → `audio.setTheme({ files })` on the service from `createAudioService()` (`./runtime`), then hand `audio.skinSounds.owned(owner)` wherever a `BeatorajaSkinAudio` is taken, such as `createBeatorajaSkinLoadContext`'s `skinAudio`.
- `player.dispose()` when a new theme replaces the old one → `audio.stopOwned(owner)`, which stops the loops that owner started.
