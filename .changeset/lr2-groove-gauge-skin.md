---
'@be-music/player-web': patch
---

Match the LR2 groove gauge bar rendering: remove the peak-hold / afterimage bead (LR2 has none — the bar tracks only the live value) and suppress the green clear-zone split for survival gauges (HARD / DEATH render the whole bar red in LR2, since they have no 80% clear border). GROOVE / EASY keep the green ≥80% zone. The per-bead cell selection is now the pure, tested `resolveGrooveGaugeBeads` helper.
