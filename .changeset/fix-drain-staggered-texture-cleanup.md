---
'@be-music/player-web': patch
---

Drain pending staggered-texture cleanup queues during scene shutdown so textures scheduled for delayed destruction don't outlive their owning scene and leak into the next chart's prepare pass.
