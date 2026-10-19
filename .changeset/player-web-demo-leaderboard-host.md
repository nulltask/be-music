---
'@be-music/player-web-demo': patch
---

On `play.be-music.app` (and its preview), the account chip and the start screen's account link open the Leaderboard on its own host, `leaderboard.be-music.app`. Elsewhere (a local dev server) they stay relative. The Cloudflare Worker moved to `@be-music/play`.
