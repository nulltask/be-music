---
'@be-music/player-browser': patch
---

Synesthesia projects its point clouds and bomb grains without allocating per point: the rotation bases are computed once per cloud or bomb and each point is written into a reused result, cutting the projection time by about a quarter to a third and the garbage the play loop produces each frame.
