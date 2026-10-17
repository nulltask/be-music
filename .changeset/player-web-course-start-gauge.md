---
'@be-music/player-web': patch
---

Fix a course stage showing `GROOVE GAUGE 20%` during READY / LOADING and graphing it on the stage result (`20 → 100 → 64`): the placeholder gauge before the engine's first frame is now the stage's course gauge at the carried-in value, so the HUD, the LR2 gauge ops and the gauge history start there. The built-in Synesthesia and Lattice results label the graph with the gauge the play ran on instead of a fixed `GROOVE GAUGE`.
