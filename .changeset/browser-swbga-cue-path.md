---
'@be-music/player-browser': patch
---

Stop applying `#SWBGAxx` as a cue-driven animation in Native, Canvas and LR2. A standard SWBGA whose id matched a cued `#BMPxx` replaced that BGA plane with its frames even without an `A5` selection or key input, unlike beatoraja and the terminal. SWBGA now animates only through the input-bound `A5` controller in every family.
