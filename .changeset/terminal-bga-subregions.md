---
'@be-music/player-terminal': patch
---

Render `#BGAxx` sub-region cues on base, both overlays and POOR instead of displaying missing-resource frames. Crop original image/video coordinates before fitting the BMS canvas, preserve authored placement and transparency, and apply the crop to streamed video frames without shifting coordinates through automatic black-border removal.
