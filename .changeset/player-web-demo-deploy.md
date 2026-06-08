---
'@be-music/player-web-demo': minor
---

Cloudflare Workers hosting and URL-based archive auto-load for the demo.

- Serve the built SPA from Workers Static Assets and stream the ~31 MB ffmpeg.wasm core (over the 25 MiB per-file asset limit) from an R2 bucket through the Worker.
- `deploy:cf` runs an md5-gated R2 sync before `wrangler deploy`, re-uploading the wasm core only when `@ffmpeg/core` actually changed (`cf:r2:push` forces an upload); CI keeps using `build:cf` + `wrangler deploy` and never touches R2.
- Open the page with `?music=https://…/song.zip` and/or `?skin=https://…/theme.zip` to auto-load a chart archive and apply a skin at boot — the archive's charts are listed in the select screen. Cross-origin archive links are fetched through the demo proxy and must use HTTPS.
