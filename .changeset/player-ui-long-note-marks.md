---
'@be-music/player-ui': patch
---

The playfield draws an HCN with rungs across its body that flow while it is held, and a back-spin scratch with a chevron on its tail cap, so LN / CN / HCN / BSS read apart without colour. `BeMusicNotesData` gains an optional `nowMs`, and the paint context also uses `moveTo`, `lineTo`, `closePath` and `fill`.
