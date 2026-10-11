---
'@be-music/skin-sdk': minor
---

Gameplay frames now carry mine notes: `frame.mines` lists each one as `{ kind, x, w, y }`, and a skin that sets `gameplay.drawsMines: true` draws them itself. Skins that leave it unset keep the player's built-in mine drawing, so existing skins still show mines.
