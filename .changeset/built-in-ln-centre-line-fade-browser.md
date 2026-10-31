---
'@be-music/player-browser': patch
---

Fade the long-note centre line out over 300 ms when the player lets go early and the note is judged dropped, in Synesthesia, Plain and the default Pixi playfield. Long-note frames now carry `releasedElapsedMs` from the play session.
