[Japanese version](./player-web.ja.md)

# Browser player implementation notes

This document summarizes the browser player added by `@be-music/player-web` and `@be-music/player-web-demo`.
Use [`player-spec.md`](./player-spec.md) for shared runtime semantics such as timing, notes, judgment, score, gauge, and BGA event meaning.

## Shared runtime integration

The browser player drives gameplay through `@be-music/player/core/engine`.
The engine owns judgment, keysound trigger routing, long-note handling, mine priority, score, gauge, and chart-finish
semantics. The LR2 gameplay scene starts one engine run at the LR2 `PLAYSTART` gate, while the beatoraja gameplay
scene mounts the engine behind `BeatorajaRuntimeAdapter`. Both paths mirror engine frame snapshots into scene state
and translate engine UI commands into Pixi visual effects.

The browser runtime uses these adapter modules:

| module                                                                            | role                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`web-audio-session.ts`](../packages/player-web/src/runtime/web-audio-session.ts) | Implements the engine's `AudioSession` contract with Web Audio. It handles immediate triggers, BGM scheduling, channel stops, pause/resume, key/BGM routing, dynamic volume changes, bmson `c=true` continuation, and `#WAVCMD` gain. |
| [`web-input-runtime.ts`](../packages/player-web/src/runtime/web-input-runtime.ts) | Maps DOM `keydown` / `keyup` events to the engine input bus. It filters OS auto-repeat, routes `Escape` / `F5` / `Space` to command events, and sends lane presses with physical event timestamps.                                    |
| [`web-ui-runtime.ts`](../packages/player-web/src/runtime/web-ui-runtime.ts)       | Drains engine UI signals into the Pixi host. Frame snapshots update notes, score, gauge, and result state; commands drive lane flashes, key holds, POOR BGA, and judge/combo effects.                                                 |
| [`engine-driver.ts`](../packages/player-web/src/runtime/engine-driver.ts)         | Wires audio, input, and UI adapters together and invokes `manualPlay` / `autoPlay` for one chart play.                                                                                                                                |

`@be-music/player/core/engine` no longer imports `node:path` / `node:timers/promises`, so the module can be
bundled into the browser as-is. The Node-only `createNodeAudioSink` backend is loaded lazily and is never reached
when the host supplies a `PlayerOptions.createAudioSession` factory (e.g. `createWebAudioSession`).

## Scope

- `@be-music/player-web` provides browser-friendly song loading, preview playback, built-in default / LR2 / beatoraja skin rendering, PixiJS scenes, WebAudio bus construction, and gameplay recording.
- `@be-music/player-web-demo` is a private Vite application that wires the core package to drag-and-drop loading, LR2/beatoraja theme loading, debug controls, and recording controls.
- The browser player supports both BMS/BME/BML/PMS and bmson charts through the same parser, chart, and player helpers used by the shared core and terminal player.

## Running the demo

```bash
pnpm run player:web
```

The command starts the Vite demo. Drop any of the following into the page:

- A BMS/BMSON song folder
- A ZIP that contains a song folder
- An LR2 theme folder
- A beatoraja theme folder
- A song folder and an LR2 or beatoraja theme folder together

When a mixed drop contains chart files, the loader treats the chart directories as song files and the remaining files as theme files.
When no chart file is present, the whole drop is treated as a theme candidate. LR2 detection uses `.lr2skin` files, while beatoraja detection uses `.luaskin` files or JSON files under a `skin/` path segment.

## Browser loading model

- Dropped paths are normalized with the shared `@be-music/utils/core` path helpers.
- Chart discovery accepts `.bms`, `.bme`, `.bml`, `.pms`, and `.bmson`.
- File lookup is case-insensitive so browser drops work with LR2 and beatoraja asset references that differ only by letter case.
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
The current shared-engine path still publishes a `GROOVE` gauge summary; LR2 gauge buttons mainly drive skin op state and the scene-local setup, and independent 2P gauge math is not wired yet.

The groove-gauge bar renders as LR2's 50 beads (2 % each) using the single `#SRC_GROOVEGAUGE` 4-cell sprite (`表赤/表緑/裏赤/裏緑` = lit-red, lit-green, unlit-red, unlit-green). Beads at or above the 80 % clear border use the green cell; below it they use red. Survival gauges (HARD / DEATH) have no clear border in LR2, so the whole bar renders red. The bar tracks the live gauge value only — there is no peak-hold / afterimage bead (LR2 has none). The bead cell-selection logic is the pure `resolveGrooveGaugeBeads` helper in `scene/lr2/gameplay-hud.ts`.

Scene-independent LR2 Pixi helpers live in [`skin/lr2/render.ts`](../packages/player-web/src/skin/lr2/render.ts) and
[`skin/lr2/scene-render.ts`](../packages/player-web/src/skin/lr2/scene-render.ts). They handle destination keyframe evaluation,
sprite transforms, source-cell selection, text rendering, numbers, sliders, and bargraphs. Scene modules keep the
state-specific value resolution, timers, and input behavior.

## Default skin family

The built-in default family is the skinless path used when no LR2 or beatoraja theme is available, or when the host
explicitly chooses the default family. It provides select, gameplay, and result presentation without requiring theme
files.

Gameplay still shares the common engine, note renderer, BGA renderer, audio bus, and input handling with
`PixiGameplayView`, but the default chrome is injected from `scene/default/gameplay.ts` through the
`skinlessChromeRenderer` option. The LR2 gameplay scene does not import the default renderer; it only provides the
shared gameplay runtime and render layers. This keeps default-skin visual changes under `scene/default/` while LR2
skin rendering remains tied to parsed `.lr2skin` data.

Default gameplay chrome uses the shared lane geometry helpers in `scene/gameplay-lanes.ts`. Scratch lanes are wider
than key lanes, 2P scratch lanes render on the right side, and DP layouts preserve the single-side lane width instead
of shrinking every lane to fit both sides into the original SP footprint. The default family uses LINE Seed JP for
general text and Azeret Mono for judgment and combo readouts.

## beatoraja skin and theme support

`@be-music/player-web` consumes `@be-music/beatoraja-skin` through `loadBeatorajaThemeFromFiles()`.
The package discovers JSON and Lua skin entries, then the browser layer loads sources, textures, fonts, theme BGM,
and system sounds from the same dropped bundle.

Implemented beatoraja browser features include:

- Select, decide, gameplay, and result scenes backed by `BeatorajaPlaySkinView`
- Play variants `5`, `7`, `9`, `10`, and `14`; `24` and `24d` skins are discovered but not mounted for chart gameplay
- Skin `property[]`, `filepath[]`, custom offsets, category groups, and mid-session `replaceSkin()` refreshes
- Runtime `TIMER_*`, `OPTION_*`, `TEXT`, and `NUM` wiring for score, combo, judge, gauge, chart metadata, clear lamp, rank, and play options
- Beatoraja-style notes, LN/CN/HCN caps and bodies, lane markers, BGA still/video layers, judge popups, timing visualizers, gauge graphs, BPM graphs, note-distribution graphs, and result score/gauge history graphs
- Select-scene folder browsing, search, keymode filtering, sort cycling, favorites, chart preview playback, select BGM, and navigation system sounds
- Decide and result BGM, chart-image synthetic slots for `STAGEFILE` / `BACKBMP` / `BANNER`, and loading-progress visuals

See [beatoraja skin implementation notes](./beatoraja-skin.md) for the renderer-independent parser and theme-loader boundary.
The default beatoraja skin is the primary compatibility target. Community themes work best when they use the normalized element families and runtime IDs listed there.

## Scene lifecycle

The browser player uses one `PixiSceneHost` for the whole session.
The host owns a single PixiJS `Application`, attaches one scene root at a time, serializes scene transitions, and destroys the renderer only when the host is disposed.

The LR2 and beatoraja paths each provide the same high-level scene set, while the default family provides the same
select, gameplay, and result shape without a decide scene:

- Select scene for chart browsing, preview playback, and skin-side interactions
- Decide scene for the short transition before gameplay when the active family supplies one
- Gameplay scene for notes, lanes, BGA, HUD, judgment, audio, and recording taps
- Result scene for score summary and skin-rendered result presentation

Scenes implement `enter()`, `exit()`, and `dispose()`.
`exit()` detaches transient listeners and ticker work for transitions, while `dispose()` permanently releases scene-owned resources.

## Renderer and performance controls

- PixiJS defaults to a WebGPU preference and falls back through PixiJS when the browser cannot initialize it.
- `?renderer=webgl` forces WebGL for renderer comparison.
- Loaded skin and BGA textures use nearest sampling to preserve LR2 and beatoraja pixel-art assets.
- beatoraja source textures are downscaled before upload when a bitmap exceeds the conservative GPU texture-size cap.
- The gameplay paths preload chart parse, audio decode, and BGA resources before the decide scene hands off to gameplay.
- Shared scroll-distance helpers keep CLI and browser note-placement behavior aligned.
- The default gameplay chrome reuses pooled Pixi children for graphics and text, and caches text styles to avoid
  per-frame allocation churn in the skinless renderer.
- Benchmarks include browser-core helpers that are pure enough to run outside a WebGL context:

```bash
pnpm bench -- --packages player-web
```

## Audio, BGA, and recording

- Chart preview and gameplay audio use WebAudio.
- Gameplay audio separates key, BGM, and master compressor stages in the default split topology.
- `?compressor=legacy` keeps the old single-compressor shape for comparison.
- `?compressor=off` disables compressor construction in the demo.
- beatoraja theme audio uses the same browser bundle lookup for Lua `main_state.audio_play` / `audio_loop` calls, select BGM, navigation system sounds, decide BGM, and result jingles.
- BGA supports still images and video assets referenced by chart BGA events.
- The default family renders the same chart BGA layer stack as LR2 skins inside its built-in BGA frame.
- BMS rendering applies the implemented `#BGAxx` sub-region, `#SWBGAxx` switching, and `#ARGBxx` / `#EXBMPxx` tint and alpha subset.
- bmson rendering uses `bga.bga_events`, `bga.layer_events`, and `bga.poor_events`; unlike BMS layer channels, bmson layer images preserve black pixels instead of treating black as transparent.
- The browser demo can transcode unsupported video assets through the ffmpeg.wasm path before playback.
- Natural chart completion waits for a short post-chart delay before opening the result scene. The visual transition
  does not cut off the remaining gameplay audio tail.
- The gameplay recorder writes WebM output and coordinates stop/finalization before scene disposal so active recordings are flushed before the gameplay bus is torn down.
- Every play records a play log (`*.bmplay.json` input replay — resolved chart, raw press/release stream, play settings; see [playlog.md](./playlog.md)). The demo auto-downloads it when the result scene mounts, controlled by the Debug Menu's "Auto-save play history" checkbox (ON by default; latched at song start and disabled during a play). The `bms-playlog` CLI re-derives LR2 / beatoraja / IIDX results from the file, and dropping a play-log onto the page replays the recorded run when the matching song is loaded.

## Compatibility boundary

The browser player is a runtime consumer of the repository's shared parser, chart, audio-renderer, player, utils, LR2 skin, and beatoraja skin packages.
When browser behavior diverges from the terminal player, prefer moving pure path, timing, scroll, lookup, or event-mapping helpers into shared packages and covering them with package-local tests.
PixiJS scene wiring can remain in `player-web` when the behavior depends on browser rendering or WebAudio resources.
