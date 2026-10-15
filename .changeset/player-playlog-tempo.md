---
'@be-music/player': minor
---

Record the play tempo in play logs: a live play run at another `PlayerOptions.speed` records it as `play.tempo` (absent = 1), and `parsePlaylog` reads it back, so a replay can play back at the tempo it was played at. A log re-recorded from a replay (`replayInputs`) records none, since a replay's speed only sets how fast it is re-driven. Inputs and judgments stay in chart time, so a re-simulation is unchanged.
