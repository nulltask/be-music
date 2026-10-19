---
'@be-music/player-web': patch
---

Dependency changes: `@be-music/audio-renderer` is dropped, as the package reads the chart timing and sample triggers from `@be-music/chart`; `@be-music/scene-model` is added for the scene models the host API takes and hands back; `signalsmith-stretch` is added for the keep-pitch tempo and is loaded only when used.
