---
'@be-music/player-web': patch
---

Stop the LR2 play scene from rebuilding Pixi's whole draw list every frame. The bitmap-text layer was re-added to the skin layer each frame, which Pixi treats as a structure change, and every bitmap-font text was torn down and rebuilt from glyph sprites each frame. The layer is now re-attached only when it is not already on top, and each text element keeps its glyph container while its string, size, tint and alpha stay the same (only its position follows the animation).
