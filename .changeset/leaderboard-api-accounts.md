---
'@be-music/leaderboard-api': minor
---

Accounts and profiles, with Better Auth:

- A player starts on an anonymous session, with no sign-up. Registering a passkey turns the account into a regular one, and Discord and Google can be linked; linking an anonymous account takes over its plays and course runs, rebuilds its bests and lists the charts its plays bring to two players with an account.
- Visitors can sign up on the site (a handle, a name, then a passkey) and sign in with a passkey; the header shows the signed-in player with Settings and Sign out.
- `GET /api/v0/me` returns the signed-in account (handle, display name, whether it is anonymous, passkey count). Players change their handle and display name (`PATCH /api/v0/me`, also on `/leaderboard/settings`) and upload an icon (`PUT` / `DELETE /api/v0/me/avatar`; WebP, PNG or JPEG up to 128 KB, cropped and shrunk to 256 px in the browser). Handles are letters, digits and `_`, 3 to 15 characters, case-insensitive; a former handle stays reserved for its player and its pages redirect. Generated handles read `player_…`, and players without an upload get an icon generated from their account.
