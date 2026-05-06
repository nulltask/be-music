[Japanese version](./player-web.ja.md)

# Browser player implementation notes

This document summarizes the browser player added by `@be-music/player-web` and `@be-music/player-web-demo`.
Use [`player-spec.md`](./player-spec.md) for shared runtime semantics such as timing, notes, judgment, score, gauge, and BGA event meaning.

## Migration to the shared engine (complete)

The browser player is migrating its judge / fallback / LN / sample-playback paths to drive
`@be-music/player/core/engine`'s `manualPlay` / `autoPlay` directly so the beatoraja-compatible behavior the engine
already implements (look-ahead lane keysound fallback, Free-Zone `17` / `27`, LN suppress windows + 380 ms / 120 ms
hold-grace, LN early-release audio cut, mine-vs-note delta priority, multi-channel input mapping) is shared with
the TUI runtime instead of being re-implemented in `pixi-gameplay.ts`.

New modules introduced for the migration:

| module | role |
| --- | --- |
| [`web-audio-session.ts`](../packages/player-web/src/web-audio-session.ts) | Web Audio API implementation of the engine's `AudioSession` contract: `triggerEvent` (immediate) / `scheduleEvent` (BGM look-ahead) / `stopChannel` / pause / resume, plus `keyMixer` / `bgmMixer` routing, dynamic volume changes (`#xxx97` / `#xxx98`), bmson `c=true` continuation suppression, and `#WAVCMD` per-slot gain. |
| [`web-input-runtime.ts`](../packages/player-web/src/web-input-runtime.ts) | Bridges DOM `keydown` / `keyup` events to the engine's `inputSignals` bus. Filters OS auto-repeat, routes `Escape` / `F5` / `Space` to interrupt / pause commands, sends everything else as `lane-input(tokens)`. |
| [`web-ui-runtime.ts`](../packages/player-web/src/web-ui-runtime.ts) | Subscribes the host (Pixi) to the engine's `uiSignals` — frame snapshots + the `flash-lane` / `press-lane` / `trigger-poor-bga` command queue. |
| [`engine-driver.ts`](../packages/player-web/src/engine-driver.ts) | Glue layer that wires the three adapters together and invokes `manualPlay` / `autoPlay`; hosts call `runEngineDriver({ chart, audio, mode, ui })` once per chart play. |

`@be-music/player/core/engine` no longer imports `node:path` / `node:timers/promises`, so the module can be
bundled into the browser as-is. The Node-only `createNodeAudioSink` backend is loaded lazily and is never reached
when the host supplies a `PlayerOptions.createAudioSession` factory (e.g. `createWebAudioSession`).

### Migration phases

- **Phase 1 (done)** — `PlayerOptions.createAudioSession` factory hook
- **Phase 2 (done)** — `WebAudioSession` implementation
- **Phase 3 (done)** — `WebInputRuntime` + `WebUiRuntime` adapters
- **Phase 4 prereq (done)** — drop the engine's `node:` imports
- **Phase 4a (done)** — `runEngineDriver` glue layer
- **Phase 4b-i (done)** — `PixiGameplayView`'s `playSample` and landmine paths now delegate to
  `WebAudioSession.triggerEvent`
- **Phase 4b-ii (done)** — BGM look-ahead now flows through `WebAudioSession.scheduleEvent`; the in-tree
  `playSampleByKey` / `connectSampleNodeWithWavCmdGain` / `activeSampleNodes` / `clampSample*` / `startSampleNode`
  helpers are removed (-181 lines)
- **Phase 5 (done)** — this document
- **Phase 4c (done)** — engine-driven playback is now the only path.
  - The view attaches a single `keydown` listener for ESC / F5 / Space / ArrowUp / ArrowDown view-side commands;
    everything else goes through `WebInputRuntime`'s own listeners into the engine's input bus. Each lane press
    carries a `pressedAt` (`KeyboardEvent.timeStamp`) snapshot the engine subtracts from its drain time so the
    judge resolves against the physical press time, not the next 60 Hz tick.
  - `tick()` only drains the engine's UI signal buses; the legacy `autoJudge` / `autoScratchJudge` / `autoMiss` /
    `autoFinalizeLongNotes` / `finalizeOverheldLongNotes` / `scheduleAutoSamples` / `checkChartEnd` /
    `judge` / `commitFinalJudge` / `triggerBombOnNonMiss` / `applyGaugeDelta` / `tryHitMine` / `playSample` /
    `markNoteHit` methods are removed (~700 lines).
  - The LR2 PLAYSTART gate launches `runEngineDriver` unconditionally so the engine's chart-time t=0 lines up
    with the view's `audioContextStartTime`.
  - `applyEngineFrame` mirrors `PlayerSummary` (score / exScore / fast / slow / gauge) into the view fields,
    propagates engine-side `judged` flags onto the view's `notes[].hit` / `mineNotes[].hit`, and stamps the LR2
    gauge-rise (timer 42) / gauge-max (timer 44) timers on every gauge transition.
  - `applyEngineCommand` translates `flash-lane` / `press-lane` / `release-lane` / `hold-lane-until-beat` /
    `trigger-poor-bga` / `clear-poor-bga` into the view-side visual-effect helpers.
  - `applyEngineJudgeCombo` drives the NOWJUDGE plate timer and combo readout via `publishJudge`.
  - `handleSharedEngineChartFinished` fires when the engine's `manualPlay` / `autoPlay` Promise resolves cleanly
    and routes through the LR2 `#FADEOUT` → `#CLOSE` exit timeline before invoking `onChartFinished` / `onExit`.
  - `dispose` aborts the engine via `AbortController` before the audio bus tears down.
  - `PlayerInterruptedError` routes `escape` → `onExit` and `restart` → `onRestart`.

## Audit note

- Audit starting point commit: `97b05e825c60e2242b621f63a1ebbfccd415362b`
- Audit point commit: `cef0f2f8a604c3a034e04b798953915e01a72549` (merge of PR #73)
- Audit scope: browser player packages, shared CLI/browser playback helpers, web-focused tests, and benchmark additions from PR #73

## Scope

- `@be-music/player-web` provides browser-friendly song loading, preview playback, LR2 skin parsing, PixiJS scenes, WebAudio bus construction, and gameplay recording.
- `@be-music/player-web-demo` is a private Vite application that wires the core package to drag-and-drop loading, theme loading, debug controls, and recording controls.
- The browser player supports both BMS/BME/BML/PMS and bmson charts through the same parser and player helpers used by the CLI.

## Running the demo

```bash
pnpm run player:web
```

The command starts the Vite demo. Drop any of the following into the page:

- A BMS/BMSON song folder
- A ZIP that contains a song folder
- An LR2 theme folder
- A song folder and an LR2 theme folder together

When a mixed drop contains chart files, the loader treats the chart directories as song files and the remaining files as theme files.
When no chart file is present, the whole drop is treated as a theme.

## Browser loading model

- Dropped paths are normalized with the shared `@be-music/utils/core` path helpers.
- Chart discovery accepts `.bms`, `.bme`, `.bml`, `.pms`, and `.bmson`.
- File lookup is case-insensitive so browser drops work with LR2-style asset references that differ only by letter case.
- Large audio and video files stay as lazy `File` references by default. Image, skin, chart, and smaller metadata files are read into bytes during collection loading.
- Folder walking and file reads use bounded concurrency and progress callbacks so large folders can load without flooding the browser's FileSystem APIs or UI update loop.
- Parse errors are accumulated in the collection instead of aborting the whole drop.

## LR2 skin and theme support

The core parser handles LR2 CSV skin files for select, decide, gameplay, and result scenes.
Play skins are grouped by key variant (`5`, `7`, `9`, `10`, `14`) so a chart can pick the matching layout at play time.

Implemented skin features include:

- `#INCLUDE` resolution relative to the current skin file
- `#CUSTOMOPTION` and `#CUSTOMFILE`
- `#SRC_IMAGE`, `#DST_IMAGE`, numbers, text, sliders, bars, gauge, judge line, measure line, BGA, and graph-like result elements
- LR2 timer and op condition evaluation used by the default LR2 skins
- `#LR2FONT` bitmap fonts and system-font text fallback
- TGA image decoding and DXA archive extraction
- Case-insensitive and wildcard asset lookup for LR2 theme files

The demo also loads LR2 theme BGM and system sounds for select and decide screens when those files exist in the dropped theme.

## Scene lifecycle

The browser player uses one `PixiSceneHost` for the whole session.
The host owns a single PixiJS `Application`, attaches one scene root at a time, serializes scene transitions, and destroys the renderer only when the host is disposed.

The current scene set is:

- Select scene for chart browsing, preview playback, and skin-side interactions
- Decide scene for the short transition before gameplay
- Gameplay scene for notes, lanes, BGA, HUD, judgment, audio, and recording taps
- Result scene for score summary and LR2 result skin rendering

Scenes implement `enter()`, `exit()`, and `dispose()`.
`exit()` detaches transient listeners and ticker work for transitions, while `dispose()` permanently releases scene-owned resources.

## Renderer and performance controls

- PixiJS defaults to a WebGPU preference and falls back through PixiJS when the browser cannot initialize it.
- `?renderer=webgl` forces WebGL for renderer comparison.
- Loaded skin and BGA textures use nearest sampling to preserve LR2 pixel-art assets.
- The gameplay path preloads chart parse, audio decode, and BGA resources before the decide scene hands off to gameplay.
- Shared scroll-distance helpers keep CLI and browser note-placement behavior aligned.
- Benchmarks include browser-core helpers that are pure enough to run outside a WebGL context:

```bash
pnpm bench -- --packages player-web
```

## Audio, BGA, and recording

- Chart preview and gameplay audio use WebAudio.
- Gameplay audio separates key, BGM, and master compressor stages in the default split topology.
- `?compressor=legacy` keeps the old single-compressor shape for comparison.
- `?compressor=off` disables compressor construction in the demo.
- BGA supports still images and video assets referenced by chart BGA events.
- The browser demo can transcode unsupported video assets through the ffmpeg.wasm path before playback.
- The gameplay recorder writes WebM output and coordinates stop/finalization before scene disposal so active recordings are flushed before the gameplay bus is torn down.

## Compatibility boundary

The browser player is a runtime consumer of the repository's shared parser, chart, audio-renderer, player, and utils packages.
When browser behavior diverges from the CLI player, prefer moving pure path, timing, scroll, lookup, or event-mapping helpers into shared packages and covering them with package-local tests.
PixiJS scene wiring can remain in `player-web` when the behavior depends on browser rendering or WebAudio resources.
