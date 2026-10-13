---
'@be-music/leaderboard-api': minor
---

Rework the Leaderboard pages:

- The header fits on one line, with a Play button (with an icon) and an account menu. The scoring rules sit in a bar beneath.
- Visitors can sign up on the site: they pick a handle and a name, then make a passkey.
- The filters are switches whose state reads at a glance.
- Rankings and play lists are compact lists that never scroll sideways on a phone.
- A chart's ranking can list every play (so a player can appear more than once) or narrow to one chart file. Plays now record their chart file (sha256 / md5) and length (migration `0004_score_files`); the hourly cron fills both in for older plays.
- Player pages show the total play time, the notes played with every judgment, and every clear lamp and DJ Rank in the legends, including those still to get.
- "New scores" is now "Latest". The LR2IR link points to the LR2IR archive only, since the original has closed.
- Indexes cover the lookups that scanned whole tables.
