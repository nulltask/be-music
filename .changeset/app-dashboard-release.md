---
'@be-music/app-dashboard': minor
---

Run Accounts in the Dashboard.

- The Dashboard now runs Accounts: sign-in, passkeys, Google and Discord, profiles, avatars and the `/login` and `/account` pages are served from `be-music.app`, and the OIDC issuer is `https://be-music.app/api/auth`. The Dashboard reads the Accounts session directly instead of signing in as an OIDC client, and its sign-out form ends that session. Accounts starts from an empty database, so every user signs in again.
- The profile page's avatar preview is round, matching the avatar everywhere else, instead of a rounded square.
- Call guest accounts guests, and treat an account as kept once Google or Discord is linked, as with a passkey.
