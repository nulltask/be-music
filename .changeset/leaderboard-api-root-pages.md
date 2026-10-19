---
'@be-music/leaderboard-api': minor
---

The pages move from `/leaderboard/*` to the root of the Leaderboard's own host (`leaderboard.be-music.app/`, `/scores/:id`, `/players/:handle`, …), and the API reference from `/leaderboard/api` to `/api-reference`. Old `/leaderboard/*` URLs are not redirected. The header's Play button opens the player of the same environment (`play.be-music.app`, or the preview's), instead of the Leaderboard's own root. The databases are renamed to `leaderboard` and `leaderboard-preview`, with their data.
