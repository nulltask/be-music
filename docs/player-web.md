[Japanese version](./player-web.ja.md)

# Browser player implementation notes

This document summarizes the browser player added by `@be-music/player-web` and `@be-music/player-web-demo`.
Use [`player-spec.md`](./player-spec.md) for shared runtime semantics such as timing, notes, judgment, score, gauge, and BGA event meaning.

## Shared runtime integration

The browser player drives gameplay through `@be-music/player/core/engine`.
The engine owns judgment, fallback keysound routing, long-note handling, mine priority, score, gauge, and chart-finish
semantics. `PixiGameplayView` starts one engine run at the LR2 `PLAYSTART` gate, mirrors engine frame snapshots into
the scene state, and translates engine UI commands into Pixi visual effects.

The browser runtime uses these adapter modules:

| module | role |
| --- | --- |
| [`web-audio-session.ts`](../packages/player-web/src/runtime/web-audio-session.ts) | Implements the engine's `AudioSession` contract with Web Audio. It handles immediate triggers, BGM scheduling, channel stops, pause/resume, key/BGM routing, dynamic volume changes, bmson `c=true` continuation, and `#WAVCMD` gain. |
| [`web-input-runtime.ts`](../packages/player-web/src/runtime/web-input-runtime.ts) | Maps DOM `keydown` / `keyup` events to the engine input bus. It filters OS auto-repeat, routes `Escape` / `F5` / `Space` to command events, and sends lane presses with physical event timestamps. |
| [`web-ui-runtime.ts`](../packages/player-web/src/runtime/web-ui-runtime.ts) | Drains engine UI signals into the Pixi host. Frame snapshots update notes, score, gauge, and result state; commands drive lane flashes, key holds, POOR BGA, and judge/combo effects. |
| [`engine-driver.ts`](../packages/player-web/src/runtime/engine-driver.ts) | Wires audio, input, and UI adapters together and invokes `manualPlay` / `autoPlay` for one chart play. |

`@be-music/player/core/engine` no longer imports `node:path` / `node:timers/promises`, so the module can be
bundled into the browser as-is. The Node-only `createNodeAudioSink` backend is loaded lazily and is never reached
when the host supplies a `PlayerOptions.createAudioSession` factory (e.g. `createWebAudioSession`).

## Scope

- `@be-music/player-web` provides browser-friendly song loading, preview playback, LR2 skin parsing, PixiJS scenes, WebAudio bus construction, and gameplay recording.
- `@be-music/player-web-demo` is a private Vite application that wires the core package to drag-and-drop loading, theme loading, debug controls, and recording controls.
- The browser player supports both BMS/BME/BML/PMS and bmson charts through the same parser, chart, and player helpers used by the shared core and terminal player.

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

See [LR2 skin implementation notes](./lr2-skin.md) for the renderer-independent parser and theme-loader boundary.
The default LR2 skin is the verified compatibility target; custom themes work best when they stay within the implemented directive families.

The select scene exposes in-scene LR2 PLAY OPTION controls for hi-speed, autoplay, BGA mode/size, filters, sort, HS-FIX, HIDDEN/SUDDEN, lane cover, auto scratch, DP flip, 1P/2P random and mirror modes, and gauge variants.
Select-time options are carried into gameplay during chart preparation.

Scene-independent LR2 Pixi helpers live in [`skin/lr2/render.ts`](../packages/player-web/src/skin/lr2/render.ts) and
[`skin/lr2/scene-render.ts`](../packages/player-web/src/skin/lr2/scene-render.ts). They handle destination keyframe evaluation,
sprite transforms, source-cell selection, text rendering, numbers, sliders, and bargraphs. Scene modules keep the
state-specific value resolution, timers, and input behavior.

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
- BMS rendering applies the implemented `#BGAxx` sub-region, `#SWBGAxx` switching, and `#ARGBxx` / `#EXBMPxx` tint and alpha subset.
- bmson rendering uses `bga.bga_events`, `bga.layer_events`, and `bga.poor_events`; unlike BMS layer channels, bmson layer images preserve black pixels instead of treating black as transparent.
- The browser demo can transcode unsupported video assets through the ffmpeg.wasm path before playback.
- The gameplay recorder writes WebM output and coordinates stop/finalization before scene disposal so active recordings are flushed before the gameplay bus is torn down.

## Compatibility boundary

The browser player is a runtime consumer of the repository's shared parser, chart, audio-renderer, player, and utils packages.
When browser behavior diverges from the terminal player, prefer moving pure path, timing, scroll, lookup, or event-mapping helpers into shared packages and covering them with package-local tests.
PixiJS scene wiring can remain in `player-web` when the behavior depends on browser rendering or WebAudio resources.
