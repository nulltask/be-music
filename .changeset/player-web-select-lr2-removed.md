---
'@be-music/player-web': minor
---

`PixiSongSelectView` and its `PixiSongSelectViewOptions` and `PixiSongSelectSystemSounds` types are removed, with the `Lr2BarBodySlot` re-export (`@be-music/lr2-skin` exports it); the LR2 select screen is made with `createSelectScene` and an LR2 kit. It now plays through the audio service like the built-in one: its BGM and preview stop as it leaves the stage, its cues and decide jingle play out, and its preview follows a search. `DEFAULT_PLAY_OPTIONS`, `matchesSearchQuery`, `wrappedCursorDelta` and the `Pixi*` play option types (`PixiPlayOptions`, `PixiSelectSort`, …) stay exported from `@be-music/player-web/scenes`, as `@be-music/scene-model`'s.

Migration:

- `new PixiSongSelectView({ skin, selectBgm, decideBgm, systemSounds, initialNavigation, initialPlayOptions, onPlayOptionsChange, resolveSongRecord, resolveCourseRecord, onSongSelected, onSongAutoPlay, onCourseSelected, onCourseAutoPlay, onSearchActivate, courseMaker, onCourseNameActivate, onCourseDeleteRequest })`, then `view.setCollection(collection)` → `createSelectScene({ family: 'lr2', skin }, { library: collection, browse: initialNavigation, playOptions: initialPlayOptions, records: { chart: resolveSongRecord, course: resolveCourseRecord }, sounds, audio, courseMaker, on: { start, playOptions: onPlayOptionsChange, search: onSearchActivate, courseMaker } })`, as for the built-in screen; `sounds` is the theme's `SystemSoundSet` (`systemSoundSetFromLr2Theme`).
- `onCourseNameActivate()` / `onCourseDeleteRequest(definition)` → `on.courseMaker('name' | 'delete', course)`, `course` the course bar under the cursor (`course.definition` is the definition to delete).
- `view.setSkin(skin)` → `scene.updateKit({ family: 'lr2', skin })`; `view.playDecideSound()` → nothing: the screen plays the decide jingle when a play starts.
- `PixiSongSelectSystemSounds` → a `SystemSoundSet` (`cursor`, `folderOpen`, `folderClose`, `optionOpen`, `optionClose`, `optionChange`, `selectBgm`, `decideBgm`).
