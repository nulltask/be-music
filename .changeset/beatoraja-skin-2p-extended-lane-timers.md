---
'@be-music/beatoraja-skin': patch
---

Fix 48 KEY 2P lane timers past key 9 (bombs, key beams, holds) lighting the 1P lanes: the 2P side now uses its own bank 100 above the 1P one, as upstream `SkinPropertyMapper` does (2P key 10 = `1110`, the 2P wheel `1125` / `1126`).
