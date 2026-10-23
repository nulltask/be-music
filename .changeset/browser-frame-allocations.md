---
'@be-music/player-browser': patch
---

Reduce repeated allocations during gameplay by retaining debug labels, resolving Canvas and DOM HUD values once per frame, and preserving active particle lists while skipping unchanged colors. Previously published HUD snapshots remain intact.
