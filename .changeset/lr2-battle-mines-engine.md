---
'@be-music/player-engine': patch
---

Fix LR2 two-player BATTLE leaving the 2P player without mines when both players pick the same lane option: LR2 copies the arranged 1P lanes to 2P mines included, so `preparePlaybackChart` takes `twoPlayerMines` to copy them too.
