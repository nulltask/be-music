---
'@be-music/player-web': minor
---

Add `?resolution=<number>` to cap the render resolution below the display's `devicePixelRatio` (e.g. `1` or `1.5`), trading sharpness for fill-rate on GPUs that cannot keep up at full density, such as tablets. Exported as `resolveRenderResolution(devicePixelRatio, search?)`.
