---
'@be-music/player-tui': patch
---

Fix `--render-audio` leaving out every `#RANDOM` / `#SWITCH` branch: the preview was rendered from the unresolved chart, so notes, keysounds and `#WAV` definitions inside control-flow blocks were missing. The CLI now draws the outcomes once, resolves the chart with them, and renders and plays that same resolution; the gameplay worker hands the engine the resolved chart with its draws, so the engine no longer rolls `#RANDOM` itself. A restart still draws again, as before.
