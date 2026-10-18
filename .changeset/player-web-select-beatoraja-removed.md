---
'@be-music/player-web': minor
---

`PixiBeatorajaSelectScene` and its `PixiBeatorajaSelectSceneOptions` and `PixiBeatorajaSelectSceneSnapshot` types are removed; the beatoraja select screen is made with `createSelectScene` and a beatoraja kit, so every select screen is. Its browsing is the browse model of `@be-music/scene-model`, as on the other families, and its sound goes through the audio service: the select BGM at the other screens' level and ducked under the chart preview, the cues, the preview and the skin's Lua sounds on the one system context, stopped as the screen leaves.

Migration:

- `new PixiBeatorajaSelectScene({ skin, textures, fonts, skinConfig, songs, courseFolders, collection, skinAudio, systemSoundPaths, selectBgmPath, restoreSnapshot, resolveSongLampOp, resolveCourseLampOp, decodeChartImages, onSongPicked, onCoursePicked, onExit, onReadtextRequest, onSkinConfigChange })` → `createSelectScene({ family: 'beatoraja', kit }, { library: collection, browse, records, sounds, audio, on: { start, exit, readtext, skinConfigChange } })`, where:
  - `kit` is `loadBeatorajaSceneKit`'s (skin, textures, fonts, options and the theme's files);
  - `library` is the collection with its course folders (the screen lists both and loads a chart's images and preview from it);
  - `records` gives the best records the bar lamps are lit from (`{ chart, course }`, as for the other families);
  - `sounds` is `systemSoundSetFromBeatoraja({ paths: systemSoundPaths, selectBgmPath })`, and `audio` the host's `createAudioService()` with the theme's files set (`audio.setTheme({ files })`) for the path-only sounds and the skin's Lua sounds;
  - `on.start(entry, { autoPlay })` replaces `onSongPicked` and `onCoursePicked` (`entry.kind` is `'song'` or `'course'`), `on.exit` replaces `onExit`, `on.readtext(chart)` replaces `onReadtextRequest` (without it the screen shows the README overlay itself), and `on.skinConfigChange(config)` replaces `onSkinConfigChange`.
- `scene.captureSnapshot()` / `restoreSnapshot` → `scene.snapshot()` / `browse` (a `BrowseSnapshot`, with the MODE and SORT choices in its `list`) and `scene.restore(snapshot)`; the LN mode choice stays with the scene while it lives. `initialIndex` and `setSelectionIndex(index)` → a `BrowseSnapshot` (`{ folderPath: [], cursors: [index] }`).
- `scene.getFocusedEntry()` → `scene.focused()`; `scene.setSearchQuery(query)` → `scene.setSearch(query)` (the host's text field does the typing: the scene's own `/` search mode is gone).
- `scene.replaceSkin({ skin, skinConfig, textures, fonts })` → `scene.updateKit({ family: 'beatoraja', kit })`.
