---
'@be-music/player-browser': patch
---

A video BGA no longer sits in memory while it plays: it plays, and transcodes through ffmpeg.wasm, straight from the dropped file instead of a copy of its bytes. A legacy BGA the browser cannot play (MPEG-1, WMV, AVI) was held three times over during its transcode and once for the rest of the play, so an 85 MB MPEG-1 BGA cut about 90 MB from the page's JavaScript memory.
