---
'@be-music/player-browser': patch
---

Synesthesia projects its point clouds, bomb grains, light rivers and manta schools without allocating per point: rotation bases are computed once per object or frame and each point is written into a reused result, so the play loop spends less time per frame and produces far less garbage.
