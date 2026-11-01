---
'@be-music/app-play': patch
---

Clearing a GRADE course whose name names a dan (七段, 皆伝, 発狂初段, …) now keeps the player's dan rank for that key mode under the judge ruleset it was played on, in `localStorage` (`be-music.dan-ranks`). Only the highest rank is kept, older storage reads as no rank, "Reset settings" keeps it and "Clear best records" clears it. No skin shows it yet: neither LR2 nor beatoraja skins have a place for it.
