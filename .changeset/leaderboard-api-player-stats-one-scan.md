---
'@be-music/leaderboard-api': patch
---

Read a player page's figures in one pass over the player's plays instead of three: the play and chart counts, dates, plays per ruleset played and the totals under the display ruleset (play time, notes, judgments) now come from one query. The figures are unchanged, including for plays stored without a result under the display ruleset.
