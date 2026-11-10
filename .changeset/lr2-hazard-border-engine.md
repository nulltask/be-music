---
'@be-music/player-engine': minor
---

LR2's HAZARD (`DEATH`) now needs HP 80 or more at the end of a single chart to clear, as LR2's CheckClear checks it like GROOVE, so a mine can leave a surviving run FAILED. The new gauge pick `DEATH-CORRECTED` is the same gauge clearing by survival; other rulesets read it as their DEATH. `GaugeSpec` takes an optional `clearBorder`.
