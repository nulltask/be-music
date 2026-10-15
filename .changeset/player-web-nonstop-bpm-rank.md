---
'@be-music/player-web': patch
---

A stitched NONSTOP play showed 150 on the BPM readouts and judged every stage with the first stage's `#RANK`. The gameplay scenes now show each stage's own BPM × its FIT rate (LR2 NOWBPM and the built-in HUD, from the stitch map's `tempo`) while the scroll stays at 150 BPM, and hand the map's `stageRanks` to the engine so later stages are judged with their own `#RANK`; a replay uses the changes its log recorded.
