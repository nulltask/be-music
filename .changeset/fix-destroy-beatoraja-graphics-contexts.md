---
'@be-music/player-web': patch
---

Destroy beatoraja-scene Pixi `GraphicsContext` instances during scene teardown so the underlying GPU resources are released. Without this the WebGL renderer's context cache grew unbounded as the player moved between scenes.
