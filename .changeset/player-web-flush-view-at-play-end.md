---
'@be-music/player-web': patch
---

The built-in and LR2 scenes send the view change still held back by the coalescer when a play ends (the outro over, or left with ESC / F5), so a hi-speed change made after the last note reaches the play log.
