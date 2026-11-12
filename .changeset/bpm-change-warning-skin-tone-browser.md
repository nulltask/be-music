---
'@be-music/player-browser': patch
---

The BPM change warning lost the right end of its text when the number of digits changed (`99 » 1000` after `60 » 240`) on Canvas skins: its figures are now drawn as tabular glyphs, sharp at the size the canvas is shown at. The built-in skins draw the box in their own type and their own blue and red, and the warning fades out after the change instead of cutting off.
