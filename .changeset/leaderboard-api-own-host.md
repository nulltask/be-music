---
'@be-music/leaderboard-api': minor
---

The Leaderboard runs as its own Worker on its own host (`leaderboard`, `leaderboard.be-music.app`; `leaderboard-preview`, `leaderboard.preview.be-music.app`) instead of only behind the player's origin, and its bare host leads to `/leaderboard`.

Better Auth now reads where it lives and where its cookies go from the bindings (`AUTH_ORIGIN`, `COOKIE_DOMAIN`, `COOKIE_PREFIX`, `TRUSTED_ORIGINS`, `PASSKEY_RP_ID`), so every service shares one session on the site's domain while Accounts is still part of this Worker. The preview names its cookies differently, so production's parent-domain cookies never collide with it. Without those bindings, local runs and tests behave as before.
