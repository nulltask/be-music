---
'@be-music/player-web': patch
---

Reject LR2 `#SRC_*` entries whose crop rectangle is empty or extends past the source texture, so the renderer never asks Pixi to crop to a zero-area or out-of-bounds region.
