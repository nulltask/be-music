---
'@be-music/player-web': patch
---

The core play scene keeps its lane geometry until the lanes, play variant, layout or stage change, instead of laying the lanes out again several times a frame, and the HUD's beat phase reuses the beat the frame already worked out.
