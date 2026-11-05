---
'@be-music/app-dashboard': minor
---

A new account is welcomed once after it signs up, on `/welcome`, before it goes back to where the sign-up started: it names the account (display name, handle checked as it is typed, avatar), a guest learns what keeping the account gives and keeps it with a passkey, Google or Discord, and it goes on to the app, Play, the Leaderboard or the Dashboard. Every step can wait. The sign-in page gains "Start with a passkey", which makes an account and its passkey in one go, and a guest who keeps the account is renamed from `Anonymous` to `Player` on Accounts too and welcomed again to name it. Run migration `0003_profile_onboarding.sql`; profiles that exist count as welcomed.
