---
'@be-music/player-browser': patch
---

Display-only play options changed during a play now take effect at once: a play screen kept the options it started with, so the auto scratch note display, the LR2 mania drawing options, the judge area, mark processed notes and the score target only changed from the next play. The new `display-options` play intent carries them.
