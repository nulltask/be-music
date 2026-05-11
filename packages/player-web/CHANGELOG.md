# @be-music/player-web

## 0.4.0

### Minor Changes

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

- b9a5f51: Fix two LN-effect regressions on the web runtime:

  1. **AUTO LN lane laser fading out mid-LN.** The renderer's
     `applyEngineCommand` handler for `hold-lane-until-beat` did not add
     the lane to `pressedChannels`, so the `flash-lane` command emitted
     in the same tick on the LN HEAD scheduled a `flashKeyOnTimer`
     setTimeout that called `releaseKeyOnTimer` ~`KEY_ON_FLASH_HOLD_MS`
     later (because the auto-release skip path checks
     `pressedChannels.has(channel)`). The lane laser therefore faded out
     ~150 ms into the LN even though the LN body kept scrolling. Adding
     the channel to `pressedChannels` on `hold-lane-until-beat` makes the
     auto-release skip the same way it does for a real key press, and
     the laser stays lit for the full LN sustain. The matching
     `release-lane` (emitted at the LN tail by
     `drainPendingAutoLongNotes` / `drainPendingAutoScratchLongNotes`)
     removes the channel and the laser fades out at the tail timing.

  2. **MANUAL LN-hold effect (sustain glow / hold sparkles) not showing.**
     The engine was emitting `hold-lane-until-beat` only on the autoplay
     LN-head path (`applyDueAutoPlayableJudgements` and
     `applyAutoScratchJudgements`); the manual LN-head path inside
     `handleMappedInputTokens` did not emit it. Without that command the
     renderer never called `startLnHoldTimer`, the LR2 LN-hold timer
     (70..89) stayed unset, and skin elements gated on it (the sustain
     glow and hold-sparkle authored by the LR2 default skin) stayed
     invisible for the whole hold. The manual LN-head path now emits
     `hold-lane-until-beat` for every LN start (mode 1 / 2 / 3), and the
     matching `release-lane` is fired from `finalizeActiveLongNote` so
     the timer fades out at every manual LN resolution moment (early
     release through `kitty-state`, mode-1 grace expiry, or end-beat
     reached).

- Updated dependencies [b9a5f51]
  - @be-music/player@0.3.1

## 0.3.0

### Minor Changes

- 5ea9072: Make the renderer and the shared engine share a single
  `PreparedPlaybackChartData` instance so view ↔ engine note-array drift is
  structurally impossible, and fix the cluster of regressions that drift
  caused on the web runtime.

  ## What changed

  ### `@be-music/player`

  - New `PlayerOptions.preparedChart` option lets the host hand the engine
    a pre-built `PreparedPlaybackChartData`. When provided,
    `autoPlay` / `manualPlay` use it verbatim and skip their own internal
    `preparePlaybackChartData` pass. Hosts that omit the option keep the
    prior behavior — the engine builds its own chart data.
  - Re-export `preparePlaybackChartData` and the
    `PreparedPlaybackChartData` type from the package root so hosts can
    build the bundle themselves before constructing the engine.
  - `PlayerStateSignals` gains a `drainPendingJudgeCombos()` method that
    returns every `publishJudgeCombo` event since the previous drain in
    publish order. The legacy `getJudgeCombo()` latch still returns the
    most recent state for HUD readout. UI runtimes that need to fan out
    per-judge effects (lane bombs, NOWJUDGE plate restarts, FC timer
    evaluations) for simultaneously-judged notes should drain the queue
    instead of polling the latch — otherwise simultaneous-press chords
    surface only the right-most lane's judge state to the host because
    every prior publish in the same engine tick is overwritten on the
    latch.

  ### `@be-music/player-web`

  - `PixiGameplayView.prepareSong` now calls `preparePlaybackChartData`
    itself, keeps the result on `this.preparedChart`, and forwards it to
    the engine through `engineOptions.preparedChart`. The renderer's
    `this.notes` / `this.mineNotes` / `this.invisibleNotes` are
    references into that bundle, so the engine and the renderer hold the
    same `TimedPlayableNote[]` / `TimedLandmineNote[]` instances.
  - The renderer reads `note.judged` directly off the shared instance
    instead of mirroring it onto a parallel `note.hit` flag through an
    index-based sync in `applyEngineFrame`. The sync block is gone.
  - `drainWebUiSignals` consumes the new `drainPendingJudgeCombos`
    queue, so simultaneously-judged AUTO PLAY chords now produce one
    bomb sprite per chord note instead of only the right-most one.
  - `score.total` is initialized from `prepared.scorableNotes.length`
    (matching the engine's `summary.total`) so the full-combo predicate
    is reachable on Free-Zone charts.
  - `buildSharedEngineChart` is reduced to clearing `bms.controlFlow`
    before handing the chart to the engine. The previous post-shuffle
    `events.map` remap (the cause of the `random1P: 'OFF'` truthy-check
    channel-class drift bug) is no longer needed because the engine
    consumes the renderer's already-shuffled note array via
    `preparedChart`.

  ## Regressions fixed (all rooted in the same drift)

  These all surfaced during Phase-4c shared-engine playthroughs and were
  each caused by the renderer's `extractTimedNotes` call disagreeing with
  the engine's. Sharing the prepared-chart instance removes the entire
  class:

  - **HIDE-on-judge dropouts**: notes vanishing partway down the lane
    before reaching the judgment line, because a `judged=true` flag from
    a different note crossed over via index mismatch
    (`#LNTYPE 1` charts, `random1P: 'OFF'` truthy-check).
  - **Mid-chart full-combo cue**: the engine's `combo` counter advanced
    faster than the renderer's `score.total` because LNs were counted
    twice on the engine side (`#LNTYPE` mismatch) or because the
    Free-Zone count inflated `score.total` past the engine's scorable
    population.
  - **AUTO PLAY exScore < 200_000**: some auto judges landed on
    already-judged duplicates and were dropped by `markScorableJudged`
    (`bms.controlFlow` re-resolved on the engine side, doubling captured
    notes). AUTO PLAY now lands on the EX-MAX 200_000 ceiling.
  - **PMS keys 6-9 mapped to IIDX 2P keys** (`j k l ;`) instead of
    `f v g b`: the engine's `resolveLaneMode` couldn't see the chart's
    `.pms` extension and fell through to `'5-key-dp'`. The renderer now
    forwards the right `laneModeExtension` baked into the prepared
    bundle.
  - **AUTO PLAY chord bombs only on the right-most lane**: the
    state-signals latch was overwriting itself; the queue surfaces every
    publish.
  - **AUTO LN sustain glow / lane laser staying lit indefinitely after
    the LN tail**: `drainPendingAutoLongNotes` (autoplay) and
    `drainPendingAutoScratchLongNotes` (manual auto-scratch) now emit
    `release-lane` after the auto judge so the LR2 LN-hold timer (70..89)
    and the lane laser (100..117) actually fade out at the LN tail.
  - **MANUAL LN BAD-failing ~380 ms into the sustain even with the key
    held**, **lane laser collapsing to a brief flash instead of staying
    lit while the key is held**: the Web input runtime now synthesizes a
    `kitty-state` press alongside `lane-input` on every keydown so the
    engine's `activeKittyPressedChannels` set keeps refreshing
    `longHoldUntilMsByChannel` for the lane.

### Patch Changes

- Updated dependencies [5ea9072]
  - @be-music/player@0.3.0

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
