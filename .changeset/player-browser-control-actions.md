---
'@be-music/player-browser': minor
---

Every operation the select, decide, play and result screens take from a key is now one table, `CONTROL_ACTIONS`, with its default keys on LR2's and beatoraja's key maps; a player's own keys for an operation (`ControlSettings.actionKeys`, and `actionKeys` for a play) take the place of its defaults. `controlActionKeys` lists an operation's keys.

The screens now match their keys by physical key (`KeyboardEvent.code`), as the lanes do, so a non-QWERTY layout plays them where a QWERTY keyboard has them (beatoraja's R, the result's R and 1-4, H / J / K for HIDDEN+); a compact keyboard's Fn + arrow still reaches PageUp / PageDown / Home / End. In a play, a key one of the chart's lanes takes is the lane's for every operation, not only F3-F5, Tab and the cover keys.
