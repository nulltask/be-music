---
'@be-music/player-tui': patch
---

Fix the chart list's note count disagreeing with the play: it counted a FREE ZONE (channel `17` / `27` of a 5 / 7 / 10 / 14 KEY chart), which nobody judges, and read the lane mode without the chart's extension, so channel `17` of a `.pms` chart could be taken for a FREE ZONE. The count now comes from the resolved chart with the chart path; cached summaries are rebuilt once.
