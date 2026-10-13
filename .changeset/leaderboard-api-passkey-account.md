---
'@be-music/leaderboard-api': minor
---

Registering a passkey now turns an anonymous account into a regular one, so its plays are listed under its handle, and the new `GET /api/v0/me` returns the signed-in account (handle, display name, whether it is anonymous, passkey count).
