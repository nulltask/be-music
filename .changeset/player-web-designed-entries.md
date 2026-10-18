---
'@be-music/player-web': minor
---

The package now exports its designed entries instead of its file layout (ADR 0005): `./host` (the scene host and the `create*Scene` host API), `./skin` (the skin families, their loading and the built-in be-music skins), `./collection`, `./audio` (the audio service, the audio bus, the master volume, the system audio session and the chart preview) and `./recording` (the gameplay recorder and its formats). `./scenes`, `./runtime` and `./chart` are removed, and so are the compatibility aliases and scene internals they carried. The root entry is the union of the new entries plus `logger` and `Rectangle`, so it loses the same names.

Migration:

- `@be-music/player-web/scenes` → `@be-music/player-web/host`.
- `BUILT_IN_BE_MUSIC_SKINS`, `phantomSkin`, `plainSkin`, `latticeSkin`, `synesthesiaSkin` from `/scenes` → `@be-music/player-web/skin`.
- `PixiPlayOptions`, `PixiBgaMode`, `PixiBgaSize`, `PixiSelectSort`, `PixiDifficultyFilter`, `PixiHiddenSudden`, `PixiHsFix`, `PixiKeysFilter`, `PixiRandomMode` from `/scenes` → `PlayOptions`, `BgaMode`, `BgaSize`, `BrowseSort`, `DifficultyFilter`, `HiddenSuddenMode`, `HsFix`, `KeysFilter`, `RandomMode` from `@be-music/scene-model`.
- `PixiGameplayResultData` from `/scenes` → `PlayResult` from `@be-music/scene-model`; `GaugeHistorySample` and `ScoreHistorySample` → the same names from `@be-music/scene-model`.
- `DEFAULT_PLAY_OPTIONS`, `matchesSearchQuery`, `wrappedCursorDelta`, `DEFAULT_HISPEED`, `HISPEED_MIN`, `HISPEED_MAX`, `HISPEED_STEP` from `/scenes` → the same names from `@be-music/scene-model`.
- `BeatorajaBgaLayer`, `BeatorajaNoteLayer`, `BeatorajaMarkerLayer`, `BeatorajaPlaySkinView` (and their option types), `BeatorajaMarkerBeats`, `lr2LastWalkedBeat`, `resolveBeatorajaNoteLane`, `beatorajaPixelsPerBeat`, `beatorajaDisplayScrollBeat` from `/scenes` → removed; draw the beatoraja play screen with `createPlayScene` and a beatoraja kit.
- `renderDefaultGameplayFrame`, `renderFallbackLr2Frame`, `FallbackGameplayRenderOptions`, `FallbackGameplayRuntime` from `/scenes` → removed; draw with `phantomSkin` through a built-in kit (`createPlayScene({ family: 'built-in', skin: phantomSkin }, …)`).
- `isInsideLr2DefaultSearchBox` from `/scenes` → removed.
- `@be-music/player-web/runtime`: the audio bus and its compressor parameters, the master volume and the audio service → `@be-music/player-web/audio`.
- `GameplayRecorder`, `makeWebmSeekable`, `downloadBlob`, `alignAudioChunk`, `resolveFrameTimestamp`, `supportsWebCodecsRecording` from `/runtime` → `@be-music/player-web/recording`.
- `serializePlaylog`, `parsePlaylog`, `resolvePlaylogFilename`, `PLAYLOG_FILE_SUFFIX`, `BeMusicPlaylog` from `/runtime` → `@be-music/player/playlog`.
- `ChartPreviewEngine`, `ChartPreviewEngineOptions`, `ChartPreviewTarget`, `LR2_PREVIEW_FOCUS_DELAY_MS`, `DEFAULT_CHART_PREVIEW_FALLBACK_DURATION_SECONDS`, `CHART_PREVIEW_STOP_FADE_OUT_SECONDS` from `@be-music/player-web/chart` → `@be-music/player-web/audio`.
- `resolveChartPreviewPath`, `collectChartPreviewTriggers`, `findFirstAudibleOffsetSeconds`, `computeBeatorajaChartMarkers` from `/chart` → removed (internal to the preview and the beatoraja views).
- `groupSongsByFolder`, `resolveChartPlayVariant` from `/collection` → `groupChartsByFolder`, `resolveLibraryChartPlayVariant` from `@be-music/scene-model`.
- `basename`, `dirname`, `normalizePath` from `/collection` → `@be-music/utils/core`.
- The be-music skin types (`BeMusicSkin`, `BeMusicSongRecord`, `BeMusicSkinSetting`, …), `resolveBeMusicLaneKind` and `resolveBeMusicSkinSettings` from `/skin` → `@be-music/skin-sdk`.
