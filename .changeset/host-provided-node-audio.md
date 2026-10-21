---
'@be-music/player-engine': minor
---

Move Node audio playback to `@be-music/player-node-audio`, removing the engine's audio renderer and Node audio dependencies. Supply `createAudioSession: createNodeAudioSession` for Node playback; an omitted factory or an unavailable adapter now plays silently. Audio factories receive the engine's resolved chart, and hosts can supply `loadAudioSampleDurations` for active-audio diagnostics. Import PCM sinks from `@be-music/player-node-audio/audio-sink`.
