---
'@be-music/chart-writer': patch
---

BMS output writes a slot's `#EXWAVxx` after its `#WAVxx` unless a later `#WAVxx` redefined it, so reading the output back keeps which one wins.
