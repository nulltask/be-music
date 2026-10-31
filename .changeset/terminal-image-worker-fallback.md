---
'@be-music/player-terminal': patch
---

Keep image pixel buffers intact when worker conversion fails, so fallback BGA conversion displays the original colors instead of a black image.
