---
'@be-music/player-web': minor
---

Add `loadBeatorajaSceneKit(options)` to `./skin`, which loads one entry of a beatoraja theme as the `BeatorajaSceneKit` the beatoraja family draws a screen with (`{ family: 'beatoraja', kit }`). It loads the skin twice (the header pass seeds the player's options for the entry, the second pass builds the skin with them, or once with the options it is given), decodes the skin's `source[]` to textures and registers its fonts. Textures, fonts and options are kept per entry path in the host's `BeatorajaSceneKitCaches`, so the next scene on the same entry reuses them, and `reloadTextures: true` decodes the textures again after an options change. A failed load says whether the header pass or the skin failed (`stage`).

The helpers around it are exported too:

- `createBeatorajaSceneKitCaches()` makes the caches, and `releaseBeatorajaSceneKitAssets(caches)` forgets the textures and disposes the fonts for a new theme, keeping the options.
- `defaultBeatorajaSkinConfig(header, files, entryPath)` gives the options an entry starts with, and `resolveBeatorajaSkinConfig(caches, entryPath, header, files)` returns the kept options or seeds them.
- `createBeatorajaSkinLoadContext({ difficulty, skinConfig, skinAudio })` gives the load-time `main_state` that decide and result skins such as ModernChic need: the chart's difficulty ops, the options' ops and the Lua `main_state.audio_*` sounds.
- `loadBeatorajaChartImages(chart, source)` decodes a chart's `#STAGEFILE`, `#BACKBMP` and `#BANNER` for a beatoraja skin's image slots -100, -101 and -102, each looked up next to the chart and then at the source's root, and `resolveBeatorajaChartImage(images, id)` reads one slot.
