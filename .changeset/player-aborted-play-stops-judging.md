---
'@be-music/player': patch
---

Fix re-simulations of ESC-aborted plays missing every note left in the chart, while the live result stopped judging at the abort. The play log now records `play.abortedAtUs`, the chart time the judge had settled through, and `simulatePlaylog` stops there; logs without it keep the previous behavior.
