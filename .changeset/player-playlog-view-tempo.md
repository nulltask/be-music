---
'@be-music/player': minor
---

Record what the player saw in play logs, apart from what was judged: `play.view` holds the hi-speed, hi-speed fix, visible time and each side's lane cover (SUDDEN+, HIDDEN+, LIFT) at the start, `play.viewChanges` every change during the play, and `play.tempoChanges` every tempo change after `play.tempo`, all in chart time. A host sends view changes as `{ kind: 'view' }` input commands; `PlaylogRecorder` gains `recordViewChange` and `recordTempoChange`. `resolvePlaylogViewAt`, `resolvePlaylogTempoAt` and `resolveReplayView` (with `PlaylogViewReplay`, which settings a replay or ghost reproduces) read them back, and `checkPlaylogEligibility` refuses a play that ran at another tempo at any point (`playedAtAnotherTempo`).
