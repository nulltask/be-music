---
'@be-music/player-web-demo': patch
---

Open the Leaderboard at `/leaderboard` without a trailing slash: the deployed demo served its own page there, since only `/leaderboard/*` reached the Leaderboard Worker.
