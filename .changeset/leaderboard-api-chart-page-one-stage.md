---
'@be-music/leaderboard-api': patch
---

Render a chart page with one database round trip less: the ranking query now brings each row's play info (the info popovers) along instead of a second query after it, and when the ranking already includes anonymous players its own player count is used instead of counting every player again.
