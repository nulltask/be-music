---
'@be-music/player-web': patch
---

Fix the song list's note count disagreeing with the play: it counted a FREE ZONE (channel `17` / `27` of a 5 / 7 / 10 / 14 KEY chart), which nobody judges, and it read the lane mode without the chart's extension. The count now comes from the resolved chart with the chart path, and matches the notes the engine scores.
