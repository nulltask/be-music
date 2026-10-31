---
'@be-music/player-browser': patch
---

Restore the white centre line down long-note bodies in the Synesthesia and Plain skins, which the translucent LN tail change had removed along with it, and fade it out over 300 ms when the player lets go early and the note is judged dropped, in Synesthesia, Plain and the default Pixi playfield. Long-note frames now carry `releasedElapsedMs` from the play session.
