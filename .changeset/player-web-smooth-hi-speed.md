---
'@be-music/player-web': patch
---

Glide the note scroll to a new hi-speed over 200 ms (eased out) instead of jumping: changing the hi-speed during play made the notes, bar lines and long notes visibly stutter to their new positions. The SPEED readout still updates at once, and judgement timing is unchanged. Applies to the built-in, LR2 and beatoraja gameplay scenes.
