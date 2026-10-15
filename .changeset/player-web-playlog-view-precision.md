---
'@be-music/player-web': patch
---

The gameplay scenes recorded their view (`play.view`, `play.viewChanges`) with float noise, such as a HIDDEN cover of `0.09999999999999999` on the beatoraja scene: they now round it with `roundPlaylogView` before recording, so the noise neither lands in the log nor records a change.
