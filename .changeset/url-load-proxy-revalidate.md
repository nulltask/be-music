---
'@be-music/worker-play': patch
---

An embed `?track=` or player `?music=` archive from another origin was downloaded in full on every load, because `/__url-load-proxy` answered `no-store` and dropped the host's validators. The proxy now answers `no-cache` and passes `ETag` / `Last-Modified` and the browser's `If-None-Match` / `If-Modified-Since` through, so an unchanged archive comes back as a 304 from the browser's cache.
