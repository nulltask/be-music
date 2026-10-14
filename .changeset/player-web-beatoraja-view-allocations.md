---
'@be-music/player-web': patch
---

Cut the beatoraja skin view's per-frame allocations: the Lua runtime context (a dozen closures) is built once per view and reads the current frame instead of being rebuilt every frame, each destination group's offset ids are worked out once instead of allocating an array per element per frame, and the runtime adapter fills one object per live offset (judge shift, lift, hidden cover) instead of a new one per element per frame.
