---
'@be-music/player-browser': patch
---

Fix three playback gaps found in review:

- A `#BMP00` POOR video shown without a channel `06` cue no longer seeks on every frame. Its start was recomputed from drifting clocks, so the video stuttered for the whole miss window.
- The select-screen preview now plays slots that only `#EXWAVxx` declares.
- A sample with an EXWAV frequency still plays when its container header cannot report a native sample rate, instead of being discarded.
