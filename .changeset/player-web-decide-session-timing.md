---
'@be-music/player-web': minor
---

A family view's skin timing can hold Escape back until input opens (`SceneViewTiming.escapeWaitsForInput`), as beatoraja's `input` holds back every key; the decide session then backs out only once input is open. Without it Escape backs out at any time, as before.

`DecideFrame.progress` reads how much of the screen's auto advance has gone by while the host reports no progress (`createDecideScene`'s `progress`), so a skin's loading bar fills as the screen moves on by itself. It stays absent for a screen that waits for the player and has no host progress.
