---
'@be-music/player-web-demo': patch
---

Courses made in the course maker now start unranked, so their runs are no longer sent to the Leaderboard. The saved courses keep each course's `release` flag across reloads (courses saved before read back ranked, as they were made), and a skipped unranked course run says so on the status line instead of blaming auto play or an aborted stage.
