---
'@be-music/player-web': minor
---

Quit a play by holding Backspace for 0.5 s, the same way Esc does, on every family. Esc collides with the browser's own leave-fullscreen key, so this gives a quit control that works in fullscreen on every browser; a tap does nothing, and Backspace is kept away from the lane input and the browser's default action. The keys also stay live after the last note until the play screen has faded out: lanes light up through the wait before the result and the fade-out, and a held key no longer stays lit.
