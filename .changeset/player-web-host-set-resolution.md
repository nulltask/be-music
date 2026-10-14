---
'@be-music/player-web': minor
---

`PixiSceneHost` takes a render resolution: `mount(container, { resolution })` asks for one at start, and `setResolution(value)` changes it from the next frame, both capped at the display's `devicePixelRatio`. `?resolution=` still overrides the mount option. Lets a host trade sharpness for fill-rate on tablets, which fell under 30 fps at full density.
