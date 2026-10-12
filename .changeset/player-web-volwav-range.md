---
'@be-music/player-web': patch
---

Fix `#VOLWAV 0` muting a chart and `#VOLWAV 200` or above amplifying it in browser gameplay and the beatoraja-skin player: `#VOLWAV` now applies only for `0 < n < 200`, as in beatoraja.
