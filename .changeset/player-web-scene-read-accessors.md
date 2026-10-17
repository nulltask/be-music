---
'@be-music/player-web': minor
---

Hosts can read more of what a scene shows: the select scenes' `getFocusedEntry()` returns the bar under the cursor (built-in, LR2 and beatoraja), the LR2 and built-in gameplay views' `getHiSpeed()` the hi-speed in force (a replay's recorded one included), and the beatoraja gameplay view's `getFrame()` the engine's latest frame (chart time, judgments and gauge so far). The web demo's end-to-end test hook reads them.
