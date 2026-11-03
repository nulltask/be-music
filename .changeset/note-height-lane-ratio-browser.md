---
'@be-music/player-browser': patch
---

The built-in Synesthesia and Plain skins draw notes, long-note caps and mines as tall as 0.21 of their lane's width (`noteHeightForLane`) instead of a fixed height, so a wider lane draws a thicker note, while a scratch note keeps a white key's height (the Pixi kit passes `whiteLaneWidth` to note renderers); notes still stand on their bottom edge.
