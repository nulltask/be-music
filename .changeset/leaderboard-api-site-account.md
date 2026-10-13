---
'@be-music/leaderboard-api': minor
---

Sign in on the Leaderboard site itself: the header shows the signed-in player (icon, handle, Settings, Sign out) or a passkey sign-in button, and `/leaderboard/settings` changes the handle, the name and the icon (pictures are cropped and shrunk to 256 px in the browser) and creates passkeys. A small client script (`client/`, bundled by `pnpm run build:client`) drives these actions.
