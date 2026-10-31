---
'@be-music/worker-play': patch
---

`/__url-load-proxy` now answers a `HEAD` request with the archive's `Content-Length` (unless it travels compressed), so the embed can show the download size before downloading.
