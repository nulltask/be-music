---
'@be-music/player-web': patch
---

Drop the `@be-music/audio-renderer` dependency: the package reads the chart timing and sample triggers from `@be-music/chart` and no longer imports the renderer.
