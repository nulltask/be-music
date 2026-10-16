---
'@be-music/player-web': patch
---

Fix beatoraja play skins swapping gauge-dependent chrome on the EX score (#430): ops 230-240 lit the EX score's tenth and 1240 stayed lit from 80 % of the EX score on. They now follow the gauge, as in beatoraja (`GaugeDrawCondition`, `Gauge.isQualified`) and LR2: 230-240 light the 1P gauge's tenth (240 a full gauge), and 1240 is lit while the gauge would clear (above 0 and at its border or more).
