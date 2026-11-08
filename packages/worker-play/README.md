[Japanese version](./README.ja.md)

# @be-music/worker-play

The Player delivery Worker on Cloudflare Workers: Static Assets for the built player ([`@be-music/app-play`](../app-play/README.md)), OIDC sessions, player settings, Leaderboard forwarding, and URL/media proxies. It also streams the ffmpeg core from R2.

See [Services and environments](../../docs/services.md).

## Deployment

Pushes to `main` and `devel` deploy every service to production and the preview (`.github/workflows/deploy.yml`). To deploy the Player by hand:

```bash
pnpm --filter @be-music/app-play run cf:r2:push # when the pinned @ffmpeg/core changes: upload the core to R2
pnpm --filter @be-music/worker-play run deploy                # production, play.be-music.app
pnpm --filter @be-music/worker-play run deploy:preview        # preview, play.preview.be-music.app
```

`deploy` builds the player and runs `cf deploy`. The ffmpeg core (`ffmpeg-core.wasm` / `ffmpeg-core.js`) exceeds the Static Assets per-file limit, so it lives in R2 and is served through the Worker.
