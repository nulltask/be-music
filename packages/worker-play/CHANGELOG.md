# @be-music/worker-play

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
