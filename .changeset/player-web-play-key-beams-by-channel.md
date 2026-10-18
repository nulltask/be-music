---
'@be-music/player-web': minor
---

Breaking: `PlayFrame.playfield` keeps the play's key beams by channel. `keyBeamStartedAt` and `keyBeamFadeStartedAt` (channel to play-clock ms) replace `timerStartedAt` and `keyOnFadeOutStart`, which were keyed by LR2's key-on timer ids, and `resolveKeyOnTimerId` is gone. Migration: a custom play view that drew LR2's key-on bank maps a channel onto its timer with `resolveLr2LaneTimer('key-on', …)` from `@be-music/lr2-skin/state`. The play screens draw the key beams as before.
