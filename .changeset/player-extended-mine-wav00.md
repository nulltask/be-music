---
'@be-music/player': patch
---

Fix a mine on an extended 24 / 48 KEY lane (`DA`–`DO` / `EA`–`EO`) detonating in silence when the chart has no mine on `D1`–`D9` / `E1`–`E9`: the engine only preloaded `#WAV00` for the classic mine lanes. It now preloads it whenever the resolved chart has a mine.
