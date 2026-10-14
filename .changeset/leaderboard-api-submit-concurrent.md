---
'@be-music/leaderboard-api': patch
---

Answer a score submission sooner: steps that do not depend on each other now run at once instead of one after another. The play log and chart document uploads run alongside the read of the player's current bests, and after the write, the chart listing refresh and the three rulesets' rank and player-count queries run together (six round trips that used to queue up). A resubmitted play's outcome is gathered the same way.
