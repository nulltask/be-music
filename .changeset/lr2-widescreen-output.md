---
'@be-music/player-browser': patch
---

Classic LR2 skins authored for widescreen output no longer appear horizontally squeezed inside a 4:3 viewport. Keep source coordinates separate from the 16:9 output canvas across select, decide, play, and result screens, and apply the same per-axis transforms to pointer input, touch lanes, and search-field placement.
