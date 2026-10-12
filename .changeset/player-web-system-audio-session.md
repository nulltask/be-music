---
'@be-music/player-web': minor
---

Add platform audio session helpers to `@be-music/player-web/runtime`, so a host can let web audio play while an iPhone / iPad is in silent mode. iOS Safari treats web audio as ambient sound that the Ring / Silent switch mutes; `applySilentModePlayback(true)` sets `navigator.audioSession.type` to `'playback'` (audible in silent mode, pauses other apps' audio) and `applySilentModePlayback(false)` restores the browser default `'auto'`. `supportsSystemAudioSession`, `getSystemAudioSession`, `applySystemAudioSessionType`, and `resolveSilentModeAudioSessionType` cover feature detection and other types. Every helper is a no-op where the Audio Session API is missing and swallows errors.
