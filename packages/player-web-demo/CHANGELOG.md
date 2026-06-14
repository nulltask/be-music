# @be-music/player-web-demo

## 0.3.1

### Patch Changes

- Updated dependencies [f07ff77]
- Updated dependencies [99324e8]
  - @be-music/player-web@0.6.2
  - @be-music/lr2-skin@0.1.4
  - @be-music/beatoraja-skin@0.1.2

## 0.3.0

### Minor Changes

- 9b7f269: Cloudflare Workers hosting and URL-based archive auto-load for the demo.

  - Serve the built SPA from Workers Static Assets and stream the ~31 MB ffmpeg.wasm core (over the 25 MiB per-file asset limit) from an R2 bucket through the Worker.
  - `deploy:cf` runs an md5-gated R2 sync before `wrangler deploy`, re-uploading the wasm core only when `@ffmpeg/core` actually changed (`cf:r2:push` forces an upload); CI keeps using `build:cf` + `wrangler deploy` and never touches R2.
  - Open the page with `?music=https://…/song.zip` and/or `?skin=https://…/theme.zip` to auto-load a chart archive and apply a skin at boot — the archive's charts are listed in the select screen. Cross-origin archive links are fetched through the demo proxy and must use HTTPS.

### Patch Changes

- Updated dependencies [9b7f269]
  - @be-music/player-web@0.6.1

## 0.2.7

### Patch Changes

- a36c2b1: Track the player-web default-chrome refactor: update `index.html` / `styles.css` for the rearranged default gameplay layout, adjust `main.ts` wiring to follow the new chrome injection seam, and clean up `readtext-overlay.ts` against the same surface.
- Updated dependencies [a36c2b1]
  - @be-music/player-web@0.6.0

## 0.2.6

### Patch Changes

- Updated dependencies [eb92249]
- Updated dependencies [eb92249]
  - @be-music/player-web@0.5.1

## 0.2.5

### Patch Changes

- 69f77d1: `discoverLr2Themes` scopes its return to `LR2files/Theme/<name>/`, which dropped shared `LR2files/` siblings (`WallPaper/`, `Bgm/`, `Sound/`, …) from the file list handed to the skin loader. The LR2 default select skin references its backdrop via the wildcard `LR2files/WallPaper/Select/*.bmp`; without the siblings the lookup failed and the select scene painted black. Union the theme's own files with all other files under `LR2files/` that aren't part of any other theme subtree, so wildcard `#CUSTOMFILE` assets resolve as before.
- 69f77d1: Extract the pure family-dispatch derivations (`availableFamiliesForScene`, `pickActiveFamilyForScene`, `hasAnyLr2Skin`) out of the demo's `PlayerWebDemoApp` god-class into a standalone `family-dispatch.ts` module that consumes a `FamilyDispatchState` snapshot. No behaviour change; the demo class trims by ~60 lines.
- 69f77d1: Split the 3,979-line demo entry point into feature modules: pull the inline HTML template (`dom-template.ts`), shared type declarations (`types.ts`), browser-compat panel (`compat-panel.ts`), READTEXT overlay (`readtext-overlay.ts`), and standalone utilities (`demo-utils.ts`) out of `main.ts`. `PlayerWebDemoApp` itself is unchanged; main.ts drops to ~3,200 lines.
- 69f77d1: Extract three self-contained slices of `PlayerWebDemoApp` into standalone modules: `chart-shape.ts` (pure derivations for chart shape + beatoraja-skin selection), `loading-overlay.ts` (DOM-only controller), `recording-controller.ts` (gameplay recorder / screenshot logic). No behaviour change; the demo class trims by ~260 lines.
- 69f77d1: Rewrite every `@be-music/player-web` import to use the matching per-area subpath (`/scenes`, `/skin`, `/chart`, `/collection`, `/runtime`). The main `@be-music/player-web` entry is reserved for top-level utilities (`logger`, `Rectangle`) that don't belong to a single area. Vite alias ordering is updated so the dev/build resolver hits the per-area barrels directly.
- Updated dependencies [3ee4d90]
- Updated dependencies [d4b427c]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [4275fef]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [cc37f42]
- Updated dependencies [18e4a48]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [a66b7aa]
- Updated dependencies [73dff9a]
  - @be-music/player-web@0.5.0
  - @be-music/lr2-skin@0.1.3
  - @be-music/beatoraja-skin@0.1.1

## 0.2.4

### Patch Changes

- b826a39: Help modal now documents beatoraja skin support alongside Lunatic Rave 2.
  The verified-skin note lists the four checked combinations: LR2 default,
  beatoraja default (`skin/default`), `ModernChic`, and `GdbG Original Skin`.
  "LR2 skin's PLAY / PLAY OPTION" wording is generalized to "the active skin's"
  since both rendering paths surface those buttons. Mirrored across the
  English and Japanese help panes. The change shipped as part of the
  beatoraja-skin work but was missed by the v0.2.3 release window.

## 0.2.3

### Patch Changes

- 06a2db9: Add **beatoraja skin** support to `player-web`, alongside the existing LR2 path.

  ### `@be-music/beatoraja-skin` (new package)

  Renderer-independent parser and normalizer for beatoraja's JSON and Lua skin formats. Covers the
  2-phase Lua evaluation contract (`skin_config = nil` → header → populated `main()`) on a Fengari
  sandbox, `if` / `values` flattening, `*` wildcard / `filepath[]` overrides, case-insensitive asset
  lookup, and per-scene theme discovery (play / select / decide / result / course-result /
  grade-result). All scene elements have strict-typed normalizers under `src/elements/` (`image`,
  `imageset`, `value`, `float-value`, `text`, `slider`, `note`, `judge`, `judge-graph`, `gauge`,
  `gauge-graph`, `bpm-graph`, `timing-visualizer`, `timing-distribution-graph`, `song-list`,
  `custom-event`, `direction`, `destination`, `pm-chara`, `graph`) with keyframe carry-forward,
  linear interpolation, `loop` wrap-around, and `divx` / `divy` cell math. `skin/default/`
  discovery wins ties against community themes that shadow it.

  ### `@be-music/player-web` (new beatoraja runtime + scenes)

  - Public entry point gains `loadBeatorajaThemeFromFiles()`, `loadBeatorajaTexturesFromBundle()`,
    `destinationToSpriteProps()`, `BeatorajaPlaySkinView`, the `BeatorajaRuntimeAdapter`, Pixi
    scenes for **decide / gameplay / result / select** (with notes / markers / BGA layers), drop
    detection helpers (`isBeatorajaSkinIndicator`, `isBeatorajaLuaSkinFilePath`,
    `isLr2SkinFilePath`), and the chart-side helpers (`prepareBeatorajaGameplayChart`,
    `computeBeatorajaChartMarkers`, `pickBeatorajaPlayableVariant`, …).
  - Beatoraja `TIMER_*` / `OPTION_*` ↔ runtime-id wiring; live `getNowCombo` override; per-plate
    POPN-9 timers / ops; `replaceSkin` refreshes textures / fonts / options mid-session.
  - Many engine-rendering fixes uncovered while wiring beatoraja skins also land here:
    POPN-9 (PMS-STD) routing, LN / CN / HCN cap pairing and orientation, HCN sprite slots, LN
    body / tail visibility after head judge, LN-hold timer re-stamping at the tail verdict,
    upstream `rxhs / 4` note scroll formula, BMFont negative-`size=` normalization, beatoraja-
    select left-info panel via `TIMER_SONGBAR_CHANGE`, song-list `title + " " + subtitle`,
    per-difficulty `level-*` digit cropping, judge-popup live combo via `getNowCombo`, destination
    clipping to the authored canvas (LR2 parity), and more.

  **Breaking** — `BrowserSongLibrary` is renamed to `BrowserSongCollectionStore`. The
  `player-web` / `beatoraja-skin` / `lr2-skin` source trees are also reorganized into
  purpose-based subdirectories (`browser/`, `chart/{,beatoraja}/`, `collection/`, `recording/`,
  `runtime/`, `scene/{,beatoraja,lr2}/`, `skin/{beatoraja,lr2}/` and per-element subfolders); the
  packages' `index.ts` re-exports the same symbols, so consumers that import from the package
  entry point are unaffected — deep imports into `packages/*/src/*` need to follow the new paths.

  ### `@be-music/chart` — broaden `resolveChartPlayVariant`

  Two new content-based detection rules so PMS-STD authored as `.bme` / `.bms` routes to `'9'`
  instead of falling through to IIDX heuristics:

  - **BME POPN-9** — `#PLAYER 1` + every one of channels `11..19` populated. IIDX 7K never lights
    up all nine columns, so a full 1P keyboard is a reliable POPN-9 signal.
  - **PMS-STD on any extension** — any of channels `22..25` AND no traditional IIDX 2P channels
    (`21` / `26..29`). Real IIDX DP always pairs each side's keyboard with `21` and / or scratch.

  ### `@be-music/player` — direct lane-mode override

  - New optional `PlayerOptions.playVariant` (`'5' | '7' | '9' | '10' | '14' | '24'`) lets the host
    pin the engine's lane mode directly. Mirrors the renderer-side variant the host has already
    classified the chart as, so BME-format POPN-9 charts mount with the correct `f / v / g / b`
    bindings instead of falling back to 7-key SP.
  - The player summary's `gauge` block now exposes the gauge `type` so consumers can label the
    clear lamp without inferring from the threshold (EASY 60 vs DEATH 0+ε collide).
  - LN engine aligned with upstream beatoraja: silent mid-hold mines, HCN gauge gain, drain rate.

  ### `@be-music/lr2-skin`

  Source tree reorganization only (drops the `lr2[-skin]-` prefix from filenames); entry-point
  exports unchanged. A few comments were translated from Japanese to English.

  ### `@be-music/player-web-demo`

  Demo gains a beatoraja-theme path in parallel with LR2 themes: a "Beatoraja preview" folder in
  the debug menu, variant dropdown (`7 / 5 / 14 / 10 / 9`), and an "Open preview" button that
  mounts `BeatorajaPlaySkinPreviewScene` inside the shared `PixiSceneHost`. Texture caches are
  memoized per entry path so reopening a variant reuses the GPU upload, and skin-options panel
  state persists across mid-edit `replaceSkin` round-trips.

- Updated dependencies [06a2db9]
  - @be-music/beatoraja-skin@0.1.0
  - @be-music/player-web@0.4.0
  - @be-music/lr2-skin@0.1.2

## 0.2.2

### Patch Changes

- Updated dependencies [b9a5f51]
  - @be-music/player-web@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [5ea9072]
  - @be-music/player-web@0.3.0

## 0.2.0

### Minor Changes

- 632f274: Initial browser player implementation. Adds two packages:

  - **`@be-music/player-web`** — vanilla PixiJS scene host
    for the LR2 chart-player flow (select / decide / play /
    result), with scene-graph rendering driven by the parsed
    LR2 skin (`#IMAGE` / `#SRC_*` / `#DST_*` keyframes, bitmap
    fonts via `#LR2FONT`, op-gated visibility, scene-stage
    timers). Loads charts and themes from drag-drop or file
    picker via a chunked enumerate / read / parse pipeline that
    publishes progress events to host UIs.
  - **`@be-music/player-web-demo`** — Vite-based demo shell
    that wires the core into a single-page app, with a lil-gui
    settings panel, a glassmorphism drop overlay, browser-
    compatibility check panel, and a Help dialog that hosts
    the usage guide plus the Open-Source attribution list
    (resolved at build time by a custom Vite plugin that walks
    the runtime dep tree).

  Headline capabilities of the core:

  - **LR2 skin rendering**: frame chrome, BGA, lane lasers,
    scratch turntable with physics-driven streak alternation,
    bomb / FC / hold timers, animated bitmap fonts, gauge /
    combo / score numbers, scroll slider.
  - **PMS / 9 KEY (Pop'n) skin support** alongside default
    IIDX 7 / 14-key layouts; per-variant skin pickers and
    channel→lane mappings. Single-side judge / combo plate
    rendering — PMS-STD charts that source lanes from the
    `2X` channel block still collapse onto the LR2 9-key
    skin's 1P-side `#SRC_NOWJUDGE` / `#SRC_NOWCOMBO` slots.
  - **BGA pipeline** — native `<video>` decode for modern codecs
    with an ffmpeg.wasm transcode fallback (single-threaded
    H.264, optional WebCodecs hardware-accelerated encode,
    optional long-edge pixel cap). Hold playback until the
    chart-start gate so the video doesn't sneak ahead during
    the LOADING / DONE intro.
  - **Web Audio bus** — split key / BGM / master compressor
    topology with per-stage toggles plus a global bypass; per-
    sample latency tuning; `MediaRecorder` + canvas
    `captureStream` for downloadable WebM gameplay capture.
  - **LR2 button wiring** — RANDOM / MIRROR, AUTO-SCRATCH, gauge
    type, HIDDEN / SUDDEN + shutter, HS-FIX, DP FLIP, BGA on /
    off / autoplay-only, BGA size NORMAL / EXTEND, score graph
    toggle, difficulty / keymode filters, song-list sort.
  - **Performance** — single shared `Application` (avoids the
    Pixi v8 batchPool race), per-section frame-timing tracker,
    cached cropped textures, sprite / text node pooling,
    static-rect graphics caching, parallel drop pipeline,
    deferred song-bundle bytes.
  - **Polish** — keyframe-inheriting LR2 parser fixes (op4 /
    loop / acc / ops), clip-mask to design rect, auto-shrink
    text, theme + library persistence across additional drops,
    scene-stage exit FADEOUT / CLOSE, intro LOADING → DONE
    flow, freeze on pause / blur, scoped colored logger.

- 135f822: Migrate the browser player to the shared `@be-music/player` engine and
  sweep rhythm-game latency end-to-end. The browser player now drives
  gameplay through `manualPlay` / `autoPlay` directly, sharing every
  beatoraja-compatible behaviour with the TUI runtime. The migration
  removed the in-tree self-judge ladder from `pixi-gameplay.ts`
  (~700 lines) and unified judging, gauging, scoring, fallback keysound
  routing, long-note handling, mine priority, and chart-finish semantics
  across both runtimes.

  **Browser parity gains** (carried over from the engine):

  - Look-ahead lane keysound fallback: an empty press plays the next
    upcoming note's keysound on that lane, like beatoraja / LR2.
  - Free-Zone `17` / `27`: empty presses on these channels play the
    authored keysound and don't trigger 空 POOR.
  - LN suppress windows + 380 ms initial / 120 ms repeat hold-grace.
  - LN early-release audio cut via `AudioSession.stopChannel`.
  - Mine vs note delta-based priority (closest delta wins).
  - Multi-channel input mapping for scratch / Free-Zone aliases
    (16↔17 / 26↔27).
  - EMPTY POOR semantics matching LR2 (no combo break, no
    `summary.poor` increment, gauge penalty per gauge type, POOR BGA).

  **Engine surface (`@be-music/player`)**:

  - `PlayerOptions.createAudioSession` factory — host-supplied audio
    backend. Defaults to the bundled Node sink when omitted.
  - `PlayerOptions.createInputRuntime` / `createUiRuntime` — host-
    supplied DOM / runtime adapters.
  - `PlayerInputCommand.pressedAt` — wall-clock-ms timestamp on
    `lane-input` and `kitty-state` so the engine judges against the
    physical press time, not its drain time. Removes up to ~16 ms of
    artificial late-bias on every press, and is `worker_threads`-safe
    via the wall-clock-ms domain (`performance.timeOrigin +
performance.now()`).
  - Event-driven drain (`createInputWakeUp`) — the inter-tick sleep is
    cut short on input arrival, so a press lands within ~1 ms of the
    next consume instead of waiting up to a 60 Hz tick.
  - `setImmediate` is preferred over `queueMicrotask` for the precise-
    wait tail spin so Node's `poll` / `check` phases run between
    iterations and `process.stdin` keypress delivery isn't starved.
  - The engine module no longer imports from `node:path` /
    `node:timers/promises`; `createNodeAudioSink` is loaded lazily
    only when no `createAudioSession` factory is supplied. Browser
    bundles can import the engine as-is.

  **Browser runtime adapters (`@be-music/player-web`)**:

  - `WebAudioSession` — Web Audio API implementation of the engine's
    `AudioSession` contract: immediate triggers, BGM scheduling,
    channel stops, pause / resume, key / BGM routing, dynamic volume
    changes (`#xxx97` / `#xxx98`), bmson `c=true` continuation, and
    `#WAVCMD` per-slot gain.
  - `WebInputRuntime` — DOM `keydown` / `keyup` → engine input bus.
    OS auto-repeat filter, `Escape` / `F5` / `Space` interrupt /
    pause routing, `pressedAt` populated from
    `performance.timeOrigin + KeyboardEvent.timeStamp`.
  - `WebUiRuntime` — drains engine `uiSignals` (frame snapshots +
    `flash-lane` / `press-lane` / `trigger-poor-bga` / etc.) into
    Pixi-side host callbacks.
  - `engine-driver.ts` — single `runEngineDriver({ chart, audio,
mode, ui })` glue over the three adapters.

  **Browser performance / latency**:

  - Pixi `Application.init({ powerPreference: 'high-performance' })`
    — pin the renderer to the discrete GPU on hybrid laptops.
  - `<canvas style="contain: content">` — compositor isolation for
    the gameplay canvas without breaking Pixi's hit-testing.
  - Master makeup gain pinned at unity (was `+1 dB`) so the
    beatoraja-style fallback keysound density doesn't expose
    audible compressor pumping.

  **TUI fixes that came along**:

  - Absolute-path arguments now resolve correctly under pure-ESM
    Node runtimes (`tsx`, `node --import tsx/esm`); the previous
    `resolveCliPath` slow path silently fell back to `cwd` when its
    lazy `eval('require')` lookup threw, turning every absolute-path
    CLI invocation into "scan cwd as a directory."
  - POOR / BAD verdict plates no longer pair with the running combo
    number (would otherwise display `POOR 5` after EMPTY POOR
    preserves combo, contradicting the LR2 visual convention).
  - In-play key input no longer silently swallowed in the TUI
    worker-thread engine — `pressedAt` is now wall-clock-ms-based
    so the main-thread input runtime and the worker-thread engine
    share a comparable clock domain.

  **Demo (`@be-music/player-web-demo`)**:

  - The shared-engine path is the only playback path; the
    `useSharedEngine` opt-in flag has been removed along with the
    Debug Menu checkbox.

### Patch Changes

- Updated dependencies [632f274]
- Updated dependencies [135f822]
  - @be-music/player-web@0.2.0
  - @be-music/lr2-skin@0.1.1
