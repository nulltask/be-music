---
'@be-music/player': patch
---

Empty POORs (空POOR) now follow the LR2 trigger condition: a phantom press charges only when a note on the same lane lies within the next 1 second (early side only, fixed window). Presses after a note or on lanes with no upcoming note are harmless keysound presses — previously every phantom press drained the gauge regardless of note proximity.
