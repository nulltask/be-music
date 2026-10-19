---
'@be-music/player-web': minor
---

The package exports designed entries instead of its file layout (ADR 0005): `./host` (the scene host and the `create*Scene` host API), `./skin` (the skin families, their loading and the built-in be-music skins), `./collection`, `./audio` (the audio service, the audio bus, the master volume, the platform audio session and the chart preview) and `./recording` (the gameplay recorder and its formats). `./scenes`, `./runtime` and `./chart` are removed, and so are the aliases and internals they carried. The root entry is the union of the new entries plus `logger` and `Rectangle`, so it loses the same names. The library entries now use chart wording, as `@be-music/scene-model` names them. The scene classes are replaced by the host API; their migration is in the notes for `createSelectScene`, `createDecideScene`, `createPlayScene` and `createResultScene`.

Migration:

- `@be-music/player-web/scenes` → `@be-music/player-web/host` (`PixiSceneHost`, `PixiScene`, `PixiSceneHostMountOptions`, `resolveRendererPreference`).
- `BUILT_IN_BE_MUSIC_SKINS`, `phantomSkin`, `plainSkin`, `latticeSkin`, `synesthesiaSkin` from `/scenes` → `@be-music/player-web/skin`.
- `PixiPlayOptions`, `PixiBgaMode`, `PixiBgaSize`, `PixiSelectSort`, `PixiDifficultyFilter`, `PixiHiddenSudden`, `PixiHsFix`, `PixiKeysFilter`, `PixiRandomMode` from `/scenes` → `PlayOptions`, `BGAMode`, `BGASize`, `BrowseSort`, `DifficultyFilter`, `HiddenSuddenMode`, `HSFix`, `KeysFilter`, `RandomMode` from `@be-music/scene-model`, whose key filters and sorts also take beatoraja's 24-key choices.
- `DEFAULT_PLAY_OPTIONS`, `matchesSearchQuery`, `wrappedCursorDelta` from `/scenes` → the same names from `@be-music/scene-model`.
- `PixiGaugeType` from `/scenes` → `GaugeType` from `@be-music/player/ruleset`.
- `PixiGameplayResultData`, `GaugeHistorySample`, `ScoreHistorySample` from `/scenes` → `PlayResult`, `GaugeHistorySample`, `ScoreHistorySample` from `@be-music/scene-model`.
- `RESULT_DYNAMIC_OPS` from `/scenes` → `LR2_OP` from `@be-music/lr2-skin/ids` (`RESULT_CLEARED` is `RESULT_CLEAR`, `RANK_NOW_*` / `RANK_PREV_*` / `RANK_NEXT_*` are `RESULT_RANK_*` / `PREVIOUS_RANK_*` / `UPDATED_RANK_*`, `RESULT_FLIP_DISABLED` / `_ENABLED` are `RESULT_FLIP_OFF` / `_ON`, `KEYCONFIG_*` are `KEY_CONFIG_*`).
- `computeResultOps` from `/scenes` → `resolveLR2ResultState` from `@be-music/lr2-skin/state`, which takes the result, the course, the played skin's `#FLIPRESULT` and the result skin's custom options instead of a skin.
- `LR2ImageRect`, `LR2BarBodySlot` from `/scenes` → `@be-music/lr2-skin`.
- `lnModeDirectiveToIndex` and `BeatorajaSelectSystemSoundPaths` from `/scenes` → `beatorajaLNModeIndex` and `BeatorajaSystemSoundPaths` from `@be-music/beatoraja-skin/scene`; `discoverBeatorajaSystemSoundPaths` and `discoverBeatorajaSelectBGMPath` from `/skin` → `@be-music/beatoraja-skin/scene`.
- `BeatorajaBGALayer`, `BeatorajaNoteLayer`, `BeatorajaMarkerLayer`, `BeatorajaPlaySkinView` (and their option types), `BeatorajaMarkerBeats`, `beatorajaPixelsPerBeat` from `/scenes` → removed; draw the beatoraja play screen with `createPlayScene` and a beatoraja kit.
- `renderDefaultGameplayFrame`, `renderFallbackLr2Frame`, `FallbackGameplayRenderOptions`, `FallbackGameplayRuntime` from `/scenes` → removed; draw with `phantomSkin` through a built-in kit (`createPlayScene({ family: 'built-in', skin: phantomSkin }, …)`).
- `isInsideLR2DefaultSearchBox`, `LR2DefaultSearchBoxHitTestInput` from `/scenes` → removed.
- The audio bus and its compressor parameters, and the master volume, from `/runtime` → `@be-music/player-web/audio`.
- `GameplayRecorder`, `GameplayRecorderOptions`, `GameplayRecorderResult`, `pickRecorderMIMEType`, `makeWebMSeekable`, `downloadBlob`, `resolveCaptureSize`, `shouldCaptureFrame`, `alignAudioChunk`, `resolveFrameTimestamp`, `supportsWebCodecsRecording` from `/runtime` → `@be-music/player-web/recording`.
- `serializePlaylog`, `parsePlaylog`, `resolvePlaylogFilename`, `PLAYLOG_FILE_SUFFIX`, `BeMusicPlaylog` from `/runtime` → `@be-music/player/playlog`.
- `ChartPreviewEngine`, `ChartPreviewEngineOptions`, `ChartPreviewTarget`, `LR2_PREVIEW_FOCUS_DELAY_MS`, `DEFAULT_CHART_PREVIEW_FALLBACK_DURATION_SECONDS`, `CHART_PREVIEW_STOP_FADE_OUT_SECONDS` from `/chart` → `@be-music/player-web/audio`.
- `resolveChartPreviewPath`, `collectChartPreviewTriggers`, `findFirstAudibleOffsetSeconds`, `AudibleOffsetBuffer`, `computeBeatorajaChartMarkers` from `/chart` → removed (internal to the preview and the beatoraja views).
- `prepareBeatorajaGameplayChart`, `PrepareBeatorajaGameplayChartOptions`, `PreparedBeatorajaGameplayChart` from `/chart` and `BeatorajaRuntimeAdapter`, `BeatorajaRuntimeAdapterOptions` from `/skin` → removed; the play session prepares every family's chart (see `createPlayScene`).
- `BeatorajaSkinAudioPlayer`, `BeatorajaSkinAudioPlayerOptions` from `/skin` → removed; see the audio service.
- `groupSongsByFolder`, `resolveChartPlayVariant` from `/collection` → `groupChartsByFolder`, `resolveLibraryChartPlayVariant` from `@be-music/scene-model`.
- `basename`, `dirname`, `normalizePath` from `/collection` → `@be-music/utils/core`.
- `BrowserSongEntry`, `BrowserFolderNode`, `BrowserBrowseEntry`, `BrowserSongSourceKind` from `/collection` → `LibraryChart`, `LibraryFolder`, `LibraryEntry`, `ChartSourceKind` from `@be-music/scene-model`. A chart bar is `{ kind: 'chart', chart }` instead of `{ kind: 'song', song }`, and a folder lists `charts`. `BrowserSongCollection`, `BrowserSongCollectionStore` and `BrowserSongAssetSource` keep their names.
- `collection.songs` → `collection.charts`, and `{ sources, songs, errors }` → `{ sources, charts, errors }` when building a collection.
- The be-music skin types (`BeMusicSkin`, `BeMusicSongRecord`, `BeMusicSkinSetting`, …), `resolveBeMusicLaneKind` and `resolveBeMusicSkinSettings` from `/skin` → `@be-music/skin-sdk`.
