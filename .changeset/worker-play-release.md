---
'@be-music/worker-play': patch
---

Serve `/sw.js` with `Cache-Control: no-cache` so browsers can detect player updates, and serve `/manifest.webmanifest` with the web app manifest content type instead of relying on Static Assets defaults.
