---
'@be-music/leaderboard-api': minor
---

Keep charts that are not listed yet to the players who played them. A chart is listed once two players with a passkey have played it; until then its plays stay out of the latest plays and other players' pages, its ranking shows a signed-in player only their own record (anonymous or not), its stats and lamp distribution are hidden, and its chart and play pages carry `noindex` for search engines. The player's own plays of such charts show to them on the latest plays and their own page, tagged "not listed" with an explanation, and the chart page says why it is not listed yet; the details row now reads "Listed publicly".
