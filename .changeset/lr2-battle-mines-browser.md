---
'@be-music/player-browser': patch
---

Fix LR2 two-player BATTLE leaving the 2P player without mines when both players pick the same lane option, as LR2 copies 1P's arranged lanes mines included. Replays rebuild the 2P mines only when they recorded them.
