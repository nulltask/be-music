---
'@be-music/player': patch
---

AUTO play logs left out `play.endOnFailure` although the play ran under it, so a re-simulation under a survival gauge judged on past where the play would have ended: `autoPlay` now records it like `manualPlay`.
