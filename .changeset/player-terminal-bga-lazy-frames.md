---
'@be-music/player-terminal': patch
---

A keyed, `#BGA`-cropped or resized video kept a transformed copy of every frame it had decoded, one per transform, so long movies held several copies. Mapped videos now transform a frame when it is shown and keep only the eight most recent.
