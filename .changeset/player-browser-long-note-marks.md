---
'@be-music/player-browser': patch
---

The Synesthesia and Plain skins tell the long-note kinds apart by shape, not colour alone:

- An HCN has a zigzag centre line (the other kinds keep it straight), and a back-spin scratch has a chevron on its tail cap; gameplay frames mark a back-spin scratch with `backSpinScratch`.
- A hell charge note shows how it stands: a violet HELL colour with a still zigzag before it is reached, a bright pulsing orange glow with the zigzag flowing into the judgement line while held, a dim red with the zigzag flowing back up the lane once let go, and the glow again when pressed back, ending at the tail. The play follows the engine's new `hell-charge` commands, so a released HCN reads as `'draining'` instead of dropped until its tail passes. LR2 skins still draw a released long note at half alpha.
- Touch lanes report no scratch spin, so a fresh tap on a held back-spin scratch turns it back.
