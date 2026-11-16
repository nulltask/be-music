---
'@be-music/player-engine': patch
---

A stitched NONSTOP chart now carries its first stage's `#STAGEFILE`, `#BANNER` (through `assetPath`), `#PLAYLEVEL` and `#DIFFICULTY`, as it does `#BACKBMP`, so the decide and play screens show the stage file and banner the NONSTOP entry stands for; before, they showed none. The map gives each stage's as `map.stages[].stageFile`, `banner`, `playLevel` and `difficulty`.
