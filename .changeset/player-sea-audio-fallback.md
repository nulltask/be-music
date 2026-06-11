---
'@be-music/player': patch
---

Load `node-web-audio-api` through the SEA-aware optional-module loader. In a single executable application the bare-specifier import always fails, which permanently disabled audio playback; the player can now pick the module up from a `node_modules` directory next to the executable (or the working directory) before falling back to silent playback.
