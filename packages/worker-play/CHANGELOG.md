# @be-music/worker-play

## 0.1.7

### Patch Changes

- b46629e: Serve the player cross-origin isolated and sign in with Accounts on the Dashboard host.
  
  - The Player Worker serves every response with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`, so the player is cross-origin isolated: key presses are timestamped and recorded in replays more finely (Chromium: 5 µs instead of 100 µs), and the BGA transcode can encode with WebCodecs over `SharedArrayBuffer`.
  - The preview Worker serves the player page and its web app manifest as "Be-Music Play (Preview)", so an installed preview player's window tells itself apart from production.
  - Play signs in with the Accounts issuer on the Dashboard host (`https://be-music.app/api/auth`), where Accounts now runs.

## 0.1.6

### Patch Changes

- f3900b2: Serve `/sw.js` with `Cache-Control: no-cache` so browsers can detect player updates, and serve `/manifest.webmanifest` with the web app manifest content type instead of relying on Static Assets defaults.

## 0.1.5

### Patch Changes

- cddcafa: Player settings stored in R2 are gzip-compressed. A plain JSON object written earlier still loads.
- 1b58c1b: Old local saves are ignored: a stored player-settings document is written as version 0, and any other version is treated as absent.
- Updated dependencies: `@be-music/service-auth-client@0.2.0`

## 0.1.4

### Patch Changes

- 7d04409: `/__url-load-proxy` now answers a `HEAD` request with the archive's `Content-Length` (unless it travels compressed), so the embed can show the download size before downloading.

## 0.1.3

### Patch Changes

- 3d0043a: An embed `?track=` or player `?music=` archive from another origin was downloaded in full on every load, because `/__url-load-proxy` answered `no-store` and dropped the host's validators. The proxy now answers `no-cache` and passes `ETag` / `Last-Modified` and the browser's `If-None-Match` / `If-Modified-Since` through, so an unchanged archive comes back as a 304 from the browser's cache.

## 0.1.2

### Patch Changes

- 95cdf96: Keep a browser's Debug Menu settings in R2, addressed by a server-set device cookie that Safari's seven-day storage cap does not delete. Preserve edit revisions independently of the server clock, use conditional writes to reject stale updates, and retain reset revisions without settings values.
- Updated dependencies: `@be-music/service-auth-client@0.1.2`

## 0.1.1

### Patch Changes

- a4d296e: Run browser page requests through the Worker so an existing Accounts login automatically signs the visitor into Play.
  
  Rename the package from `@be-music/play` to `@be-music/worker-play` to identify its role consistently. Update imports and package filters to the new name.
- Updated dependencies: `@be-music/service-auth-client@0.1.1`

## 0.1.0

### Minor Changes

- 8a051a5: Provide the Play Worker on separate production and preview hosts, serving the browser player and FFmpeg files from its environment's own storage.
  
  - Sign in through Accounts OIDC with host-only sessions.
  - Forward Leaderboard API requests through a Service Binding, replacing browser credentials with the server-held resource token.
  - Link ranking pages to the Leaderboard host of the same environment.
  
  The Worker serves player assets and API forwarding; Leaderboard pages are served by Leaderboard itself.

### Patch Changes

- Updated dependencies: `@be-music/service-auth-client@0.1.0`
