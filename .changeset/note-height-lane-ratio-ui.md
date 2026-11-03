---
'@be-music/player-ui': patch
---

The playfield painter draws notes, long-note caps and mines as tall as 0.21 of their lane's width (`noteHeightForLane`) instead of a fixed 6 px, so a wider lane draws a thicker note, with every note as tall as a white key's (`BeMusicNotesData.whiteLaneWidth`); notes still stand on their bottom edge.
