---
'@be-music/player-engine': patch
---

A chart's nanasigroove `774:RANDOM_RANDOM+` is recorded in the replay as its own lane value `RANDOM+` instead of beatoraja's `RANDOM-EX`, so a replay no longer reads as if the player chose beatoraja's option. The shuffle is unchanged, and replays recorded before keep `RANDOM-EX`.
