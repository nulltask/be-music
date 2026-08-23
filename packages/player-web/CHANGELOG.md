# @be-music/player-web

## 0.7.0

### Minor Changes

- ab210cb: Record a play log (`*.bmplay.json` input replay) for every gameplay run: the LR2/default gameplay scene exposes it through `PixiGameplayResultData.playlog`, the beatoraja scene through `PixiBeatorajaGameplayView.getPlaylog()`, and the `@be-music/player-web/runtime` subpath re-exports the playlog serializer helpers (`serializePlaylog`, `parsePlaylog`, `resolvePlaylogFilename`) for hosts.

  The LR2/default gameplay scene also plays a recorded log back: `PixiGameplayViewOptions.replay` re-applies the log's resolved note arrangement onto the freshly prepared chart (`applyPlaylogArrangement` — RANDOM / MIRROR arrangements replay without re-rolling) and feeds the recorded inputs through the engine's deterministic replay path, restoring the log's judge-window ruleset. The `@be-music/player-web/collection` subpath adds `computeChartFileSha256` / `computeSha256Hex` for stamping and matching the playlog's chart-file hash, and both gameplay scenes accept the host-computed hash and judge ruleset for recording.

### Patch Changes

- Emit declaration-compatible types for the beatoraja theme's playable-variant constant so consumers building under `isolatedDeclarations` no longer fail on the inferred `as const satisfies ...` type.
- Updated dependencies
- Updated dependencies
- Updated dependencies [ab210cb]
  - @be-music/lr2-skin@0.1.5
  - @be-music/player@0.6.0

## 0.6.2

### Patch Changes

- f07ff77: Match the LR2 groove gauge bar rendering: remove the peak-hold / afterimage bead (LR2 has none — the bar tracks only the live value) and suppress the green clear-zone split for survival gauges (HARD / DEATH render the whole bar red in LR2, since they have no 80% clear border). GROOVE / EASY keep the green ≥80% zone. The per-bead cell selection is now the pure, tested `resolveGrooveGaugeBeads` helper.
- 99324e8: `#xxx97` / `#xxx98` dynamic volume changes in the WebAudio session now apply only to voices triggered after the event, matching the documented semantics and the Node engine. Previously the web runtime wrote the new gain onto the shared bus mixers, retroactively changing the volume of already-playing voices.
- Updated dependencies [b2c4f9b]
- Updated dependencies [b9922cf]
- Updated dependencies [4d5a89e]
- Updated dependencies [254e213]
- Updated dependencies [7bbf052]
- Updated dependencies [811cdfc]
- Updated dependencies [d0bb321]
- Updated dependencies [ebfdba7]
- Updated dependencies [ca1012c]
- Updated dependencies [6ce9173]
- Updated dependencies [7802f98]
- Updated dependencies [cdc42a1]
- Updated dependencies [ca1012c]
  - @be-music/parser@0.2.3
  - @be-music/json@0.2.2
  - @be-music/player@0.5.0
  - @be-music/audio-renderer@0.2.3
  - @be-music/utils@0.3.0
  - @be-music/chart@0.3.2
  - @be-music/lr2-skin@0.1.4
  - @be-music/beatoraja-skin@0.1.2

## 0.6.1

### Patch Changes

- 9b7f269: Song-select preview, skinless DP chrome, same-slot retrigger, and audio-bus fixes for the browser player.

  - Song-select chart preview now auditions AUTO PLAY-style — visible play-lane keysounds and BGM are audible, while invisible `3x` / `4x` objects are excluded (they only update lane keysound state during gameplay, not the preview), and previews fade out over 250 ms when switching or stopping instead of cutting abruptly.
  - Skinless (default-skin) DP gameplay chrome reworked: dropped the top info bar, added a dedicated score panel, and made the fallback playfield layout side-aware so 2P / DP charts render their lanes correctly.
  - Retriggering the same `#WAV` slot now stops the previously playing BMS source instead of letting both ring out, fixing the doubled/overlapping sample on rapid same-slot retrigger.
  - Rebalanced the Web Audio bus gain staging: a -3 dB input trim ahead of the per-bus / master compressors with a matching +3 dB makeup after, plus retuned compressor params (higher thresholds, gentler ratios, softer knees), so hot source files keep headroom and the compressors act on real overloads instead of smashing normal hits. `off` mode still bypasses trim, compressors, and makeup.
  - Bump pixi.js to 8.19.0.

- Updated dependencies [9b7f269]
  - @be-music/player@0.4.3

## 0.6.0

### Minor Changes

- a36c2b1: Separate default-chrome injection from the LR2 gameplay scene so the default gameplay scene can paint its own chrome without dragging the LR2 skin pipeline along.

  New `scene/gameplay-chrome.ts` and `scene/gameplay-lanes.ts` modules hold the shared chrome / lane drawing; the LR2 gameplay scene now consumes those modules. The default scene's font setup, lane sizing, and decide / result transitions land closer to the LR2 skin's authored values, so charts that load without a skin render a more readable playfield.

## 0.5.1

### Patch Changes

- eb92249: Bump `fflate` from 0.8.2 to 0.8.3.
- eb92249: Cap beatoraja texture decoding at four concurrent jobs through `runWithConcurrency` instead of dispatching every asset in parallel via `Promise.all`. Themes that ship hundreds of bitmaps (the LITONE families, several Hi-Speed packs) used to allocate every decoded `ImageBitmap` plus its backing `ArrayBuffer` at the same time, peaking gameplay heap by several hundred MB before the GC could reclaim the input buffers. The bounded scheduler keeps memory pressure proportional to the worker count.
- Updated dependencies [eb92249]
  - @be-music/player@0.4.2

## 0.5.0

### Minor Changes

- 69f77d1: Split `@be-music/player-web`'s public surface from a single grab-bag `./` entry into five per-area subpaths: `./scenes`, `./skin`, `./chart`, `./collection`, `./runtime`. The main `.` export keeps re-exporting everything, so existing imports continue to work unchanged. New code should prefer the per-area subpaths to make the dependency surface explicit (e.g. importing only from `@be-music/player-web/scenes` shows the consumer doesn't reach into chart preprocessing or song-collection helpers).

### Patch Changes

- 69f77d1: `BeatorajaMarkerLayer.update` previously picked only the first prototype per marker kind (`group` / `bpm` / `stop` / `time`) via `kind.find(...)` and painted it at every beat. DP skins that author one destination per side (1P-side + 2P-side) only saw markers rendered on the 1P side as a result. Iterate every registered prototype per kind, matching beatoraja's upstream `LaneRenderer.java` loop, so both sides paint measure lines / BPM-change lines / STOP markers / time-tick markers.
- 69f77d1: Bound the zip-archive decode path's working memory so opening a multi-gigabyte chart pack no longer materializes every entry in RAM at once. Entries are now streamed through the song-collection loader and released as soon as their files are handed off.
- 69f77d1: Destroy beatoraja-scene Pixi `GraphicsContext` instances during scene teardown so the underlying GPU resources are released. Without this the WebGL renderer's context cache grew unbounded as the player moved between scenes.
- 69f77d1: Discard scenes whose `enter()` throws (e.g. a skin failed to prepare, or an audio dependency rejected) instead of leaving them attached to the shared `PixiSceneHost`. Subsequent mounts no longer inherit half-initialized state from the failed predecessor.
- 69f77d1: Disconnect each per-source `GainNode` from the Web Audio graph as soon as its `BufferSourceNode` ends, so long sessions no longer leak nodes that the audio session's `dispose()` would have to chase down on shutdown.
- 69f77d1: Drain pending staggered-texture cleanup queues during scene shutdown so textures scheduled for delayed destruction don't outlive their owning scene and leak into the next chart's prepare pass.
- 69f77d1: Skip beatoraja sprite props whose `src` index points at a missing image entry so a malformed theme no longer renders a placeholder rectangle in its place.
- 69f77d1: Suppress beatoraja BGA sprites whose backing texture failed to load instead of painting a transparent placeholder; charts referencing missing BMP entries no longer leak unbacked sprites onto the BGA composite layer.
- 69f77d1: Prevent the chart-preview audio scheduler from resuming playback after the preview has been disposed (e.g. the user moved off the song before the buffer decoded), so a previously-disposed `ChartPreview` no longer emits sample triggers into the next preview's audio context.
- 69f77d1: Reject LR2 `#SRC_*` entries whose crop rectangle is empty or extends past the source texture, so the renderer never asks Pixi to crop to a zero-area or out-of-bounds region.
- 69f77d1: Cache dynamic beatoraja crop textures across frames in the skin view so animated sprite layers no longer allocate a fresh cropped `Texture` per tick. Frees the GC pressure that surfaced as periodic stalls on sprite-heavy beatoraja themes.
- 4275fef: Call `scheduler.yield()` through the `scheduler` receiver instead of extracting the method into a bare variable. Detached method invocation lost the `this` binding and crashed with `Illegal invocation` on browsers that ship the Scheduler API natively, so `loadSongCollectionFromFiles` froze mid-parse on Chrome's scheduler-yield code path. The `setTimeout(0)` fallback for browsers without the API is unchanged.
- 69f77d1: Serialize BGA video FFmpeg transcodes through a single-flight queue so charts that reference several `.mpg` / `.avi` BGAs no longer launch parallel `ffmpeg.wasm` workers and exhaust browser memory.
- 69f77d1: Yield to macrotasks while parsing a large chart so the page stays responsive (loading overlay animation, scrollbar, click handlers) and the browser doesn't flag the tab as unresponsive on multi-MB BMS / BMSON files.
- 69f77d1: Precompute `sortedChromeEntries` (tagged union over image / number / text / button / onMouse / slider) once per LR2 select-scene skin reference. The previous render path merged six arrays into `work[]` and called `.sort()` every frame; the underlying skin is frozen after parse so the order is static. Per-frame visibility (op gating, panel-open gating, DST keyframe evaluation) still happens during the switch dispatch — only the merge / sort step is hoisted out.
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [956fd01]
- Updated dependencies [73dff9a]
  - @be-music/lr2-skin@0.1.3
  - @be-music/beatoraja-skin@0.1.1
  - @be-music/player@0.4.1
  - @be-music/utils@0.2.1
  - @be-music/audio-renderer@0.2.2
  - @be-music/json@0.2.1
  - @be-music/parser@0.2.2
  - @be-music/chart@0.3.1

## 0.4.0

### Minor Changes

- 06a2db9: Add beatoraja skin support alongside the existing LR2 path.

  Public entry points include `loadBeatorajaThemeFromFiles()`, `loadBeatorajaTexturesFromBundle()`, `destinationToSpriteProps()`, `BeatorajaPlaySkinView`, the `BeatorajaRuntimeAdapter`, Pixi scenes for decide / gameplay / result / select, drop-detection helpers (`isBeatorajaSkinIndicator`, `isBeatorajaLuaSkinFilePath`, `isLr2SkinFilePath`), and chart helpers (`prepareBeatorajaGameplayChart`, `computeBeatorajaChartMarkers`, `pickBeatorajaPlayableVariant`).

  Rendering fixes that landed with the beatoraja path: POPN-9 (PMS-STD) routing, LN / CN / HCN cap pairing and orientation, LN body / tail visibility after head judge, upstream `rxhs / 4` note scroll, BMFont negative-`size=` normalization, destination clipping to the authored canvas, and related select / judge-popup wiring.

  **Breaking** — `BrowserSongLibrary` is renamed to `BrowserSongCollectionStore`. The package source tree is reorganized into purpose-based subdirectories; the package entry point re-exports the same symbols, so consumers that import from the package root are unaffected.

### Patch Changes

- Updated dependencies [06a2db9]
  - @be-music/beatoraja-skin@0.1.0
  - @be-music/chart@0.3.0
  - @be-music/player@0.4.0
  - @be-music/lr2-skin@0.1.2
  - @be-music/audio-renderer@0.2.1
  - @be-music/parser@0.2.1

## 0.3.1

### Patch Changes

- b9a5f51: Fix two LN-effect regressions.

  - AUTO LN lane laser no longer fades out ~150 ms into the sustain: `hold-lane-until-beat` now keeps the lane in `pressedChannels` so the same-tick `flash-lane` auto-release is skipped.
  - MANUAL LN-hold effects (sustain glow / hold sparkles) now show: the renderer starts the LR2 LN-hold timer (70..89) for every LN start and fades it at the tail.

- Updated dependencies [b9a5f51]
  - @be-music/player@0.3.1

## 0.3.0

### Minor Changes

- 5ea9072: `PixiGameplayView.prepareSong` now builds a `PreparedPlaybackChartData` and forwards it to the engine through `engineOptions.preparedChart`, so the renderer and the engine share the same note instances instead of mirroring `note.hit` through an index-based sync.

  That removes the class of view ↔ engine drift bugs: notes vanishing mid-lane (HIDE-on-judge dropouts), mid-chart full-combo cues, AUTO PLAY falling short of EX-MAX, PMS keys 6-9 mapping to IIDX 2P, chord bombs only on the right-most lane, AUTO LN lasers staying lit after the tail, and MANUAL LN BAD-failing mid-sustain while the key is held. Simultaneously-judged AUTO PLAY chords now produce one bomb sprite per chord note via `drainPendingJudgeCombos`.

### Patch Changes

- Updated dependencies [5ea9072]
  - @be-music/player@0.3.0

## 0.2.0

### Minor Changes

- 632f274: Initial browser player: a PixiJS scene host for the LR2 chart-player flow (select / decide / play / result) driven by the parsed LR2 skin (`#IMAGE` / `#SRC_*` / `#DST_*` keyframes, `#LR2FONT` bitmap fonts, op-gated visibility, scene-stage timers). Charts and themes load from drag-drop or file picker.

  Headline capabilities:

  - LR2 skin rendering: frame chrome, BGA, lane lasers, scratch turntable, bomb / FC / hold timers, animated bitmap fonts, gauge / combo / score, scroll slider.
  - PMS / 9 KEY (Pop'n) skin support alongside IIDX 7 / 14-key layouts, with single-side judge / combo plate rendering for PMS-STD charts that source lanes from the `2X` channel block.
  - BGA pipeline: native `<video>` decode with an ffmpeg.wasm transcode fallback, held until the chart-start gate.
  - Web Audio bus: split key / BGM / master compressor topology, per-sample latency tuning, and `MediaRecorder` + canvas `captureStream` for WebM gameplay capture.
  - LR2 button wiring: RANDOM / MIRROR, AUTO-SCRATCH, gauge type, HIDDEN / SUDDEN + shutter, HS-FIX, DP FLIP, BGA / score-graph / filter controls.

- 135f822: Drive gameplay through the shared `@be-music/player` engine (`manualPlay` / `autoPlay`) instead of the in-tree self-judge ladder, so the browser player shares judging, gauging, scoring, fallback keysound routing, long-note handling, mine priority, and chart-finish semantics with the TUI.

  New host adapters: `WebAudioSession` (Web Audio API `AudioSession`), `WebInputRuntime` (DOM keydown / keyup with `pressedAt` from `performance.timeOrigin + KeyboardEvent.timeStamp`), `WebUiRuntime` (engine `uiSignals` → Pixi callbacks), and `runEngineDriver` glue.

  Latency / audio: pin Pixi to `powerPreference: 'high-performance'`, isolate the gameplay canvas with `contain: content`, and pin master makeup gain at unity so fallback-keysound density doesn't pump the compressor.

### Patch Changes

- Updated dependencies [632f274]
- Updated dependencies [632f274]
- Updated dependencies [632f274]
- Updated dependencies [632f274]
- Updated dependencies [135f822]
- Updated dependencies [135f822]
  - @be-music/parser@0.2.0
  - @be-music/chart@0.2.0
  - @be-music/player@0.2.0
  - @be-music/audio-renderer@0.2.0
  - @be-music/json@0.2.0
  - @be-music/utils@0.2.0
  - @be-music/lr2-skin@0.1.1
