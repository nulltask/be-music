---
'@be-music/player-web': patch
---

A miss during a stitched NONSTOP play showed the stitched chart's POOR image whatever stage was on screen. `splitNonstopBgaTimeline` now splits the POOR cues by stage too, and each stage's BGA stack shows its own POOR image in place of its base and layer at the stage's crossfade opacity, without a `#BMP00` fallback, as LR2 copies the shown stage's POOR image (`LR2body.exe` 0x4350df).
