---
'@be-music/player-scene-model': minor
---

`resolveRandomModes` offers the lane options only one source defines under every ruleset: R-RANDOM, SPIRAL, H-RANDOM, ALL-SCR, RANDOM-EX, S-RANDOM-EX and the PMS arrangements (beatoraja), and SCATTER (LR2). CONVERGE stays with LR2 and beatoraja. Its second argument now means the 1P side of a chart copied onto both sides, which adds SYNCHRONIZE RANDOM and SYMMETRY RANDOM; the new `isDuplicatedBattleChoice` tells those battle modes apart (#774).
