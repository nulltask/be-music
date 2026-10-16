---
'@be-music/player-web': patch
---

A full combo on the built-in and LR2 play screens now counts every note as its max combo for any play, as it already did in AUTO, even when the combo the engine published reached fewer notes; a course stage's course combo follows it. The play screens keep one scene-model `PlayState` and read the result off it (`playResultFromPlayState`), so the result also carries each judgment's early / late count (`earlyLate`).
