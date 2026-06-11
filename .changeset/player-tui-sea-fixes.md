---
'@be-music/player-tui': minor
---

Make the TUI player work as a Node single executable application (SEA).

- Gameplay, UI, and BGA-video workers are now spawned from an embedded copy of the SEA bundle (eval workers dispatched by the new `sea-main` entry on a workerData role marker); previously the worker URL resolution threw under SEA and playback silently never started.
- The CLI entry refuses to start from a worker thread, since inside SEA workers `process.argv[1]` still equals `process.execPath`.
- `@uwx/libav.js-fat` (video BGA) loads through the SEA-aware optional-module loader, so a `node_modules` directory next to the executable now works.
- SEA binaries embed `node-web-audio-api` (with its dependency closure, filtered to the target platform's native addon) and extract it once into `~/.be-music/sea-embedded-modules` at startup, so audio playback works out of the box; a `node_modules` directory next to the executable still takes precedence.
