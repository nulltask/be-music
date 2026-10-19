---
'@be-music/accounts': minor
---

The Accounts Worker (`accounts.be-music.app`, `accounts.preview.be-music.app`): Better Auth's base URL. It forwards `/api/auth/*`, OAuth callbacks included, to the Leaderboard Worker, which still holds Better Auth, and sends the bare host to the dashboard.
