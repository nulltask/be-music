---
'@be-music/player-terminal': patch
---

Decode BGA codecs supported by the bundled LibAV build, including HEVC and VP9/WebM, instead of rejecting every codec except MPEG-1, H.264 and MJPEG. Stop the loading pass after its first converted frame.
