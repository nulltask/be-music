---
'@be-music/player-ui': patch
---

The Native playfield tells the long-note kinds apart like the built-in skins:

- An HCN has a zigzag centre line (the other kinds keep it straight), and a back-spin scratch has a chevron on its tail cap, so LN / CN / HCN / BSS read apart without colour.
- A hell charge note shows a violet HELL colour before it is reached, a bright orange glow with the zigzag flowing into the judgement line while held, and a dim red with the zigzag flowing back up while draining.
- `BeMusicNotesData` gains an optional `nowMs`, and the paint context also uses `moveTo`, `lineTo`, `closePath`, `fill`, `stroke`, `strokeStyle` and `lineWidth`.
