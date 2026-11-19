---
'@be-music/app-play': patch
---

Fix the NEW GENERATION difficulty tables (and any other host that refuses a request without a User-Agent) failing to load with 403 through the player's URL proxy: the proxy now names itself as `Be-Music URL proxy (+https://play.be-music.app)` upstream.
