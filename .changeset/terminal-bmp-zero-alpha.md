---
'@be-music/player-terminal': patch
---

Treat a 32-bit BMP whose alpha mask is set but whose alpha bytes are all zero as opaque. Such files, common from image tools, rendered as a black base or an invisible layer.
