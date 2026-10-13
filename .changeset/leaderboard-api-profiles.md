---
'@be-music/leaderboard-api': minor
---

Players can change their handle and display name (`PATCH /api/v0/me`) and upload an icon (`PUT` / `DELETE /api/v0/me/avatar`; WebP, PNG or JPEG up to 128 KB). Handles are letters, digits and `_`, 3 to 15 characters, case-insensitive; a former handle stays reserved for its player and its pages redirect. Players without an upload get an icon generated from their account. Icons show on the player page and next to names in the tables. Generated handles become `player_…` (migration `0002_profiles` renames the existing ones and keeps the old URLs working).
