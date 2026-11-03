---
'@be-music/player-browser': patch
---

A chart without `#PREVIEW` no longer stops its select-screen preview mid-phrase with long samples ringing on: the in-place preview fades out over the last 3 seconds of its 30-second window and stops there. A play cut short by its gauge emptying now fades its sound out over the skin's close time (1.5 s on the built-in skins), with the closing animation, instead of cutting it at once as LR2 and beatoraja do.
