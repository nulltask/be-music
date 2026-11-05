# @be-music/worker-play

## 0.1.6

### Patch Changes

- 816a5d2: Serve `/sw.js` with `Cache-Control: no-cache` so browsers can detect player updates, and serve `/manifest.webmanifest` with the web app manifest content type instead of relying on Static Assets defaults.

## 0.1.5

### Patch Changes

- 1a6400b: Player settings stored in R2 are gzip-compressed. A plain JSON object written earlier still loads.
- 51dd4c6: Old local saves are ignored: a stored player-settings document is written as version 0, and any other version is treated as absent.
- Updated dependencies: `@be-music/service-auth-client@0.2.0`

## 0.1.4

### Patch Changes

- c6437bc: `/__url-load-proxy` now answers a `HEAD` request with the archive's `Content-Length` (unless it travels compressed), so the embed can show the download size before downloading.

## 0.1.3

### Patch Changes

- afcbc07: An embed `?track=` or player `?music=` archive from another origin was downloaded in full on every load, because `/__url-load-proxy` answered `no-store` and dropped the host's validators. The proxy now answers `no-cache` and passes `ETag` / `Last-Modified` and the browser's `If-None-Match` / `If-Modified-Since` through, so an unchanged archive comes back as a 304 from the browser's cache.

## 0.1.2

### Patch Changes

- 4a4b111: Keep a browser's Debug Menu settings in R2, addressed by a server-set device cookie that Safari's seven-day storage cap does not delete. Preserve edit revisions independently of the server clock, use conditional writes to reject stale updates, and retain reset revisions without settings values.
- Updated dependencies: `@be-music/service-auth-client@0.1.2`

## 0.1.1

### Patch Changes

- 325e7bb: Run browser page requests through the Worker so an existing Accounts login automatically signs the visitor into Play.
  
  Rename the package from `@be-music/play` to `@be-music/worker-play` to identify its role consistently. Update imports and package filters to the new name.
- Updated dependencies: `@be-music/service-auth-client@0.1.1`

## 0.1.0

### Minor Changes

- b2818d0: Provide the Play Worker on separate production and preview hosts, serving the browser player and FFmpeg files from its environment's own storage.
  
  - Sign in through Accounts OIDC with host-only sessions.
  - Forward Leaderboard API requests through a Service Binding, replacing browser credentials with the server-held resource token.
  - Link ranking pages to the Leaderboard host of the same environment.
  
  The Worker serves player assets and API forwarding; Leaderboard pages are served by Leaderboard itself.

### Patch Changes

- Updated dependencies: `@be-music/service-auth-client@0.1.0`
