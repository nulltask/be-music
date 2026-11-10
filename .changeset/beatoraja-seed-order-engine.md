---
'@be-music/player-engine': patch
---

Fix a beatoraja seed putting mines and hidden notes on other lanes than beatoraja does under S-RANDOM, H-RANDOM, S-RANDOM-EX, ALL-SCR, PMS CONVERGE and S_RANDOM_PLAYABLE: a timeline's lanes without a note now go to the lanes past the jack threshold first, as beatoraja places them. DP ALL-SCR also takes the lowest-numbered lane on 1P and the highest on 2P, where a released long note used to change its pick.
