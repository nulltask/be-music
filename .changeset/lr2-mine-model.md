---
'@be-music/player': minor
---

Mines now follow the LR2 detonation model: a mine explodes while its lane's key is ON and the mine is within the GOOD window of the judge line — covering both presses with a mine in range and holding through a passing mine; a mine passing with the key up is harmless. Explosions only drain the gauge (raw base36 value as the damage percent, matching LR2 / beatoraja, instead of the nanasi value/2 rule) and play #WAV00 — no BAD verdict, no combo break, and mines no longer swallow presses aimed at nearby notes. Mine damage bypasses the HARD guts softening and #TOTAL multiplier; ZZ instantly fails survival gauges.
