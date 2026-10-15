---
'@be-music/player': minor
---

Add helpers for hosts that record and replay the view of a play: `diffPlaylogView` lists what changed between two view states (the full cover of a changed side), `createPlaylogViewCoalescer` folds a view sampled every frame into at most one recorded change per interval so a wheel spin does not flood the log, and `resolveReplayHiSpeed` picks the hi-speed a replay shows (the recorded one on the same scale, else the one matching the recorded visible time). A view state gains `hiSpeedScale`, the scene family whose scale its `hiSpeed` is on.
