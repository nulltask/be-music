---
'@be-music/player-browser': patch
---

With beatoraja scroll REMOVE on a chart with BPM changes, S-RANDOM, H-RANDOM and the other time-based arrangements could put a generated mine on a note or a note on a long note's end. REMOVE recomputes some objects' seconds a float step away from the notes on the same timeline, so the arrangement now groups objects by whole microseconds, as the source timelines do.
