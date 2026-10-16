---
'@be-music/player-web': minor
---

Add `loadBeatorajaSceneKit(options)` to `@be-music/player-web/skin`, which loads one entry of a beatoraja theme as the `BeatorajaSceneKit` the beatoraja family draws a screen with. It loads the skin twice (the header pass seeds the player's options for the entry, the second pass builds the skin with them, or once with the options it is given), decodes the skin's `source[]` to textures and registers its fonts. Textures, fonts and options are kept per entry path in the host's `BeatorajaSceneKitCaches`, so the next scene on the same entry reuses them; `reloadTextures` decodes the textures again after an options change. A failed load says whether the header pass or the skin failed (`stage`).

The helpers around it are exported too:

- `createBeatorajaSceneKitCaches()` makes the caches, and `releaseBeatorajaSceneKitAssets(caches)` forgets the textures (without destroying them) and disposes the fonts for a new theme, keeping the options.
- `defaultBeatorajaSkinConfig(header, files, entryPath)` is the options an entry starts with (each `property[]` default, each `filepath[]` default file matched against the theme's files), and `resolveBeatorajaSkinConfig(caches, entryPath, header, files)` returns the kept options or seeds them.
- `createBeatorajaSkinLoadContext({ difficulty, skinConfig, skinAudio })` is the load-time `main_state` decide and result skins such as ModernChic need: the chart's difficulty ops, the options' ops and the Lua `main_state.audio_*` sounds.

The web demo loads every beatoraja select, decide, play and result skin through it, as it did before.
