---
'@be-music/player-web': patch
---

A beatoraja play ignored HS-FIX: the notes scrolled at the player's hi-speed at every BPM, and the play log recorded `hsFix: 'OFF'`. `createPlayScene` with a beatoraja kit now plays the host's `hsFix` as every family does: the drawn hi-speed (the one the skin's hi-speed numbers and the note layer read) is the player's rescaled at the chart's MAXBPM, MINBPM or main BPM, and the play log's view records the mode.
