---
'@be-music/player-web-demo': patch
---

Rewrite every `@be-music/player-web` import to use the matching per-area subpath (`/scenes`, `/skin`, `/chart`, `/collection`, `/runtime`). The main `@be-music/player-web` entry is reserved for top-level utilities (`logger`, `Rectangle`) that don't belong to a single area. Vite alias ordering is updated so the dev/build resolver hits the per-area barrels directly.
