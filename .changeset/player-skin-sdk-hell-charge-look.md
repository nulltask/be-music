---
'@be-music/player-skin-sdk': minor
---

A released hell charge note no longer reads as dropped for good: `BeMusicLongNoteState` gains `'draining'`, the state of an HCN whose lane is up while it passes the judgement line (let go early or missed at the head), which goes back to `'held'` when the lane is pressed again. New `resolveHellChargeLook` gives a hell charge note's look by state (a violet HELL colour on standby, an orange glow while held, a dim red while draining), pairing each colour with a glow strength, a zigzag colour (`lineColor`) and a zigzag motion (`flow`: `1` down, `-1` back up, `0` still) for `hellChargeZigzag`.
