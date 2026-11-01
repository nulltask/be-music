---
'@be-music/app-leaderboard': patch
---

Assisted plays are now classified by their options' sources rather than by AUTO SCRATCH and the judge-window override alone, and each ruleset's lamp follows that ruleset's assist rule. A `no-save` play (BATTLE under That-Which-Must-Not-Be-Named rules) is stored unranked as `no-save`, and a course run with an assisted stage is stored unranked as `assist`. LIGHT ASSIST EASY is stored as lamp rank 10 and shown between ASSIST EASY and EASY in bests, previous bests and lamp spreads. Results stored before this change are not recomputed.
