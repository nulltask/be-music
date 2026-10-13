---
'@be-music/player-web': patch
---

Keep the keys live after the last note until the play screen has faded out: lanes still light up (and a held key no longer stays lit) through the wait before the result and the fade-out, in the built-in, LR2 and beatoraja play screens. The play's engine is held open past the chart's end and let go when the outro is over; the result arrives with its final summary as before.
