---
'@be-music/play': minor
---

Provide the Play Worker on separate production and preview hosts, serving the browser player and FFmpeg files from its environment's own storage.

- Sign in through Accounts OIDC with host-only sessions.
- Forward Leaderboard API requests through a Service Binding, replacing browser credentials with the server-held resource token.
- Link ranking pages to the Leaderboard host of the same environment.

The Worker serves player assets and API forwarding; Leaderboard pages are served by Leaderboard itself.
