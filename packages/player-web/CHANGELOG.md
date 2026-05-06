# @be-music/player-web

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
