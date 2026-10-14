---
'@be-music/player-web': patch
---

Holding Backspace for 0.5 s during play now quits it the same way Esc does, in both the core and the beatoraja gameplay scenes. Esc collides with the browser's own leave-fullscreen key, so this gives a quit control that works in fullscreen on every browser; a tap does nothing, and Backspace is kept away from the lane input and the browser's default action.
