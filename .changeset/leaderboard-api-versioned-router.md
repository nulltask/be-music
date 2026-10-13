---
'@be-music/leaderboard-api': patch
---

Mount the API as a versioned sub-app at `/api/v1`, so a later version can sit next to it. Unknown paths under `/api`, an unknown version included, now answer a JSON `404` instead of a plain-text one.
