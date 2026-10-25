---
'@be-music/player-browser': patch
---

Native screens on a phone held upright asked to rotate it. While Native shows, the stage canvas is out of the page and the Pixi screen keeps the size it last resized to, so the screens now read their orientation from the element they are mounted in.
