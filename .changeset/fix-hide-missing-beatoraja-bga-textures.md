---
'@be-music/player-web': patch
---

Suppress beatoraja BGA sprites whose backing texture failed to load instead of painting a transparent placeholder; charts referencing missing BMP entries no longer leak unbacked sprites onto the BGA composite layer.
