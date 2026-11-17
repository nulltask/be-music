---
'@be-music/app-play': patch
---

Fix the browser console logging a CORS error for the METTATUNES and The Forgetalia Bemuse servers each time the player opens: their origin now goes straight to the player's proxy, and any other origin that needed the proxy is remembered in `localStorage` so it is tried directly only once.
