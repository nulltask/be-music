---
'@be-music/stringifier': patch
---

Fix `stringifyBmson(json, { resolution })` shifting notes into later measures when the requested resolution differs from the source bmson's: notes were rescaled but the preserved `lines` were written unchanged (a resolution 240 chart written at 480 kept its bar lines at y=960/1920, so a note in measure 1 came back in measure 2). Preserved `lines` are now rescaled by the output / source resolution ratio.
