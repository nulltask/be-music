---
'@be-music/player': patch
---

Fix `resolveBmsControlFlowForPlayback` playing a different `#RANDOM` branch than the one it reported after a line with a single outcome (`#RANDOM 1`, a `#RANDOM` without a valid range, or `#SWITCH 1`): it drew a value for that line, but the parser never consumes one there, so every later replayed draw landed on the previous line. Draws are now taken only for lines with more than one outcome, so the RANDOM pattern summary always matches the branches that play.
