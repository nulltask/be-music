---
'@be-music/leaderboard-api': patch
---

Fix linking a Discord or Google account failing for an anonymous player who had played three or more charts: rebuilding their personal bests wrote every row in one insert and listed every chart in one `IN`, past D1's 100 bound parameters per statement. The rebuild now splits its statements to stay under the limit, and runs the delete and the inserts in one batch so the bests are never left half rewritten. Claiming an account (registering a passkey) now lists the charts it played in one statement instead of two or three queries per chart, which could run past the per-request query limit for a player with many charts.

Linking a Discord or Google account now also lists the charts that the plays it takes over bring to two players with an account; they used to stay unlisted until someone sent another play on them.
