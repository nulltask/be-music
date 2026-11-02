---
'@be-music/app-leaderboard': minor
---

A play or course run that one ruleset cannot judge (a gauge it does not define, or CUSTOM JUDGE outside beatoraja) is no longer refused or judged with the option dropped: that ruleset stores no figures, and the submission answers it in `notSimulated` with the reason. A play that used gauge auto-shift is judged under every ruleset along that ruleset's own gauge ladder. A run that ended where its gauge emptied is judged under another ruleset only up to that point; when that ruleset's gauge would have survived, its figures are stored as `outcome: 'truncated'`, move no personal best and stay out of the rankings and lists (ADR 0019, migration `0019`).
