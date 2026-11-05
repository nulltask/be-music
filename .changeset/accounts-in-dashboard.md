---
'@be-music/app-dashboard': minor
---

The Dashboard now runs Accounts: sign-in, passkeys, Google and Discord, profiles, avatars and the `/login` and `/account` pages are served from `be-music.app`, and the OIDC issuer is `https://be-music.app/api/auth`. The Dashboard reads the Accounts session directly instead of signing in as an OIDC client, and its sign-out form ends that session. Accounts starts from an empty database, so every user signs in again.
