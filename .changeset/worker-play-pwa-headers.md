---
'@be-music/worker-play': patch
---

The Worker serves the installable player's service worker (`/sw.js`) with `Cache-Control: no-cache`, so a deploy reaches browsers at their next start, and its web app manifest (`/manifest.webmanifest`) as `application/manifest+json`, whatever the Static Assets defaults are.
