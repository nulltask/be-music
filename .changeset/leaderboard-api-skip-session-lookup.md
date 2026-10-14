---
'@be-music/leaderboard-api': patch
---

Skip the session lookup on requests without a session cookie. Every page and API request used to build the auth setup and ask it for a session, even for signed-out visitors and public API reads, where the answer can only be "none". Pages and the API now check for Better Auth's session cookie first.
