---
'@be-music/player-web': patch
---

A click on a bar's title text in a beatoraja select skin was sometimes lost: the bar list layer was interactive, so Pixi hit-tested the title label above the row's hit area and sent the click to the layer, which has no listener. The layer is now passive, so only the row hit areas take clicks.
