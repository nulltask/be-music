---
'@be-music/player-web': patch
---

Hide notes, mines and bar lines whose time has passed under beatoraja's drawing rules (charts with `#SCROLL` / `#SPEED`), judged or not, as beatoraja does. A note a negative `#SCROLL` carried back above the line no longer lingers there until its miss, and a note under a STOP that began on it no longer sits on the line. A long note stays while its end is still ahead, and once its head has passed the head stays on the judgement line until the tail's time, as in beatoraja; this also shows in LR2 skins.
