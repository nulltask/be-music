---
'@be-music/player-skin-sdk': minor
---

Add `BeMusicGameplayRuntime.songInfoFade` and `resolveSongInfoLayers`: while a NONSTOP play's song info crossfades into the next stage's, the runtime carries the song being replaced and the crossfade's progress, and `resolveSongInfoLayers(runtime)` returns the layers to draw, each with its opacity, so a skin crossfades its title block by drawing it once per layer.
