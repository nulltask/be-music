---
'@be-music/player-web': minor
---

`DefaultPixiSongSelectView` and its `DefaultPixiSongSelectViewOptions` type are removed; the built-in select screen is made with `createSelectScene`. The LR2 select screen (`PixiSongSelectView`, on `CoreSongSelectView`) is unchanged and still plays on a context of its own.

Migration:

- `new DefaultPixiSongSelectView({ beMusicSkin, beMusicEffects, beMusicSkinSettings, selectBgm, decideBgm, systemSounds, initialNavigation, initialPlayOptions, onPlayOptionsChange, resolveSongRecord, resolveCourseRecord, onSongSelected, onSongAutoPlay, onCourseSelected, onCourseAutoPlay, onSearchActivate })`, then `view.setCollection(collection)` → `createSelectScene({ family: 'built-in', skin: beMusicSkin, effects: beMusicEffects, settings: beMusicSkinSettings }, { library: collection, browse: initialNavigation, playOptions: initialPlayOptions, records: { chart: resolveSongRecord, course: resolveCourseRecord }, sounds, audio, on: { start, playOptions: onPlayOptionsChange, search: onSearchActivate } })`, where `audio` is the host's `createAudioService()` and `sounds` a `SystemSoundSet` with `selectBgm`, `decideBgm` and the cue slots (`cursor`, `folderOpen`, `folderClose`, `optionOpen`, `optionClose`, `optionChange`).
- `onSongSelected` / `onSongAutoPlay` / `onCourseSelected` / `onCourseAutoPlay` → `on.start(entry, { autoPlay })`, with `entry` a `{ kind: 'song', song }` or a `{ kind: 'course', course }`. Return `false` when it starts no play, and the screen plays no decide sound.
- `view.playDecideSound()` → nothing: the screen plays the decide jingle (`sounds.decideBgm`) when a play starts.
- `getNavigation()` / `setNavigation()` → `snapshot()` / `restore()`; `setCollection()` → `setLibrary()`; `setSearchQuery()` → `setSearch()`; `getSearchFieldRect()` → `searchFieldRect()`; `getFocusedEntry()` → `focused()`; `isVisible()` → `entered`; `setSelectBgm()` / `setDecideBgm()` / `setSystemSounds()` → `setSounds()`; `setBeMusicSkinSettings(settings)` → `updateKit({ ...kit, settings })`.
