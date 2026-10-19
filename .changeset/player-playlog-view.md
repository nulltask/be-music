---
'@be-music/player': minor
---

Record what the player saw in play logs, apart from what was judged:

- `play.view` holds the hi-speed, hi-speed fix, visible time and each side's lane cover (SUDDEN+, HIDDEN+, LIFT) at the start, and `play.viewChanges` every change during the play, in chart time. A host sends view changes as `{ kind: 'view' }` input commands, and `PlaylogRecorder` gains `recordViewChange` and `recordTempoChange`. A change sent as a play ends, after the engine's last input drain or still held back by the coalescer, is recorded too.
- `resolvePlaylogViewAt`, `resolvePlaylogTempoAt` and `resolveReplayView` (with `PlaylogViewReplay`, which settings a replay or ghost reproduces) read them back, and `resolveReplayHiSpeed` picks the hi-speed a replay shows: the recorded one on the same scale, else the one matching the recorded visible time. A view state carries `hiSpeedScale`, the scene family whose scale its `hiSpeed` is on.
- `diffPlaylogView` lists what changed between two view states (the full cover of a changed side); `createPlaylogViewCoalescer` folds a view sampled every frame into at most one recorded change per interval, so a wheel spin does not flood the log, and its `flush` returns a change still held back; `roundPlaylogView` brings a view to the precision a log records it at (the hi-speed on a 1/1000 grid, `visibleMs` in whole ms and each cover part to 4 decimals), so recorded views carry no float noise such as `0.09999999999999999`.
