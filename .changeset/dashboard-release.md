---
'@be-music/dashboard': minor
---

Provide the Dashboard service at the environment's root domain with account status and links to Play, Leaderboard and account management.

- Sign in through Accounts OIDC using a host-only session.
- Retrieve the current public profile directly from Accounts through a Service Binding or HTTPS, without creating a Leaderboard player.
- Support Japanese and English with responsive styling shared with Leaderboard.
- Hide donation links in production and keep the link discreetly in the preview footer.
