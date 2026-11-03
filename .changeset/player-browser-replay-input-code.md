---
'@be-music/player-browser': patch
---

Replays now record the physical key behind each press and release (`KeyboardEvent.code`, such as `'KeyZ'`), and `'touch'` for touch lanes. Before, a touch tap was recorded as its lane's keyboard key and could not be told apart from a key press.
