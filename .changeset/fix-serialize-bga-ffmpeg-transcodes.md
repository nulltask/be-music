---
'@be-music/player-web': patch
---

Serialize BGA video FFmpeg transcodes through a single-flight queue so charts that reference several `.mpg` / `.avi` BGAs no longer launch parallel `ffmpeg.wasm` workers and exhaust browser memory.
