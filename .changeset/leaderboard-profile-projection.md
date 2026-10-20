---
'@be-music/leaderboard-api': patch
---

Read public profiles and avatars from Accounts, direct profile editing there, and clear legacy authentication records while preserving player IDs and scores. Store binary score data in the service-named R2 bucket.

Pull profile updates through the Accounts binding or HTTPS instead of accepting reverse notifications from Accounts.
