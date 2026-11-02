---
'@be-music/player-skin-sdk': minor
---

Skins can tell the long-note kinds and a hell charge note's state apart:

- `BeMusicLongNote.backSpinScratch` marks a back-spin scratch, and new helpers draw the kinds by shape rather than colour: `resolveLongNoteMarks`, `isBackSpinScratchLongNote`, `hellChargeZigzag` (an HCN's zigzag centre line, as a polyline that can flow either way) and `backSpinChevron` (the chevron on a BSS's tail cap).
- A released hell charge note no longer reads as dropped for good: `BeMusicLongNoteState` gains `'draining'`, the state of an HCN whose lane is up while it passes the judgement line (let go early or missed at the head), which goes back to `'held'` when the lane is pressed again.
- `resolveHellChargeLook` gives a hell charge note's look by state (a violet HELL colour on standby, an orange glow while held, a dim red while draining), pairing each colour with a glow strength, a zigzag colour (`lineColor`) and a zigzag motion (`flow`: `1` down, `-1` back up, `0` still) for `hellChargeZigzag`.
