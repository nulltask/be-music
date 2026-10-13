---
'@be-music/leaderboard-api': minor
---

Give each play in the lists more context and less noise:
- A Latest row shows the chart's mode and level (`7K ☆12`), the EX-Score gained over the player's previous best, a raised lamp (`EASY CLEAR → CLEAR`), fewer misses, the lane option (`RANDOM`) and the play's place on the chart (`#3 / 12`); the gauge shows only for a failed play, the ruleset reads "played with LR2 rules", and the "new chart" tag is gone.
- The DJ LEVEL sits next to the score rate in every list and result card; the play's info icon has its own column at the end of the row, and its panel adds the lane option and play length, explains the verification layer and lists the app once when it both recorded and sent the play.
- The chart page shows the level and difficulty in its header, hides the per-row play count when listing every play, shows each file's play count in the file switch, names the long-note mode with what it means, and groups the links elsewhere by file, each marked as leaving the site.
- Digits are tabular across the site.

Charts take their level from play logs that carry it, and plays get their lane option from their logs, the older ones through the hourly backfill (migration `0005_score_context`).

The scoring rules switch moves from its own bar into a menu in the header, and a new About page (`/leaderboard/about`, linked from the header) explains how plays are scored, how charts are known, accounts, the checks, personal bests and the beta state.
