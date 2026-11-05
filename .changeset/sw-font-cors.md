---
'@be-music/app-play': patch
---

Fix skins drawing with the browser's default fonts after the player became cross-origin isolated: the service worker had cached the Google Fonts stylesheet as an opaque answer, which a COEP page cannot read back, so the stylesheet failed to load. The worker now fetches the fonts with CORS, never stores an opaque answer, treats an unreadable cache entry as a miss, and drops the old fonts cache on activation.
