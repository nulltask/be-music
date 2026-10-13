---
'@be-music/player-web-demo': minor
---

Add "Submit to Leaderboard" to the Debug Menu (off by default): a finished manual play is sent to the Leaderboard when the result scene mounts, signing in anonymously the first time, and its rank shows in the status line. The Worker forwards `/api/*` and `/leaderboard/*` to the Leaderboard Worker, and the dev server proxies them to a local one.
