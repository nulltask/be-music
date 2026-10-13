---
'@be-music/leaderboard-api': patch
---

Serve the API at `/api/v0` (the beta, which may still change incompatibly) as a versioned sub-app, so a stable `/api/v1` can later sit next to it. Unknown paths under `/api`, an unknown version included, now answer a JSON `404` instead of a plain-text one.
