---
'@be-music/player-web': patch
---

Touch taps on the play screens no longer record their release before their press in the play log, so a replay and the play-log simulators no longer hold a tapped lane down after the tap (its mines went off, a long note tapped that way was held on). The fix is in the engine's input stamping (`@be-music/player`).
