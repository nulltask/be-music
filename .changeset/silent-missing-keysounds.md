---
'@be-music/audio-renderer': patch
'@be-music/player': patch
---

Missing, undefined, or undecodable `#WAVxx` references are now silent by default, matching LR2 / beatoraja. The synthesized sine fallback tone is opt-in: pass `fallbackToneSeconds` to the audio-renderer APIs or `missingSampleToneSeconds` to the player engine when a debugging tone is wanted.
