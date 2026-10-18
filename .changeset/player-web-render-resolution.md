---
'@be-music/player-web': minor
---

Let a host trade sharpness for fill rate on GPUs that cannot keep up at full density, such as tablets, which fell under 30 fps. `PixiSceneHost.mount(container, { resolution })` asks for a render resolution and `setResolution(value)` changes it from the next frame, both capped at the display's `devicePixelRatio`. `?resolution=<number>` in the page URL overrides them (`resolveRenderResolution(devicePixelRatio, search?)`, `./host`).
