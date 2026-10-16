---
'@be-music/lr2-skin': patch
---

Fix LR2 texts 18 / 28 drawing the difficulty's name (BEGINNER … INSANE): LR2 draws the chart's `#DIFFICULTY` number there (OpenLR2 `ProcS_Select` sets them with `SetObjectStringInt`), and skins name the difficulty with the ops 150-155. They now read `0`-`5`, or nothing for a chart without `#DIFFICULTY`, on every screen.
