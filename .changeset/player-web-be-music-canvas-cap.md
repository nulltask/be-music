---
'@be-music/player-web': patch
---

Fix a be-music skin's canvas growing past 4096 pixels on a portrait stage. The surface capped only the canvas width, so a portrait stage, which is taller than it is wide, could allocate a canvas over 4096 pixels tall on a large or high-density upright screen. The cap now applies to the long side, whichever it is.
