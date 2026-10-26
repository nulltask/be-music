---
'@be-music/player-browser': patch
---

Fix the display-area information drifting off the cover edges on the Native skin: its DOM labels were placed in the renderer's screen size, which differs from the page's CSS size, instead of the size of their own layer.
