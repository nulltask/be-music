---
'@be-music/player': minor
---

Record the play tempo in play logs: a play run at another `PlayerOptions.speed` records it as `play.tempo` (absent = 1), and `parsePlaylog` reads it back, so a replay can play back at the tempo it was played at. Inputs and judgments stay in chart time, so a re-simulation is unchanged.
