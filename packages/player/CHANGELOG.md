# @be-music/player

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

## 0.2.0

### Minor Changes

- 632f274: End-to-end support for the beatoraja `#BASE 62` ID extension
  (case-sensitive 62-character object IDs `0-9A-Za-z`, four
  times the address space of the original `0-9A-Z` 36-base).

  - **`@be-music/parser`**: detects the `#BASE 62` header and
    decodes channel-row IDs case-sensitively under it.
  - **`@be-music/chart`** / **`@be-music/stringifier`**: thread
    the `base` through every `parseInt` / `toString` site so
    serialised charts round-trip without dropping casing.
  - **`@be-music/editor`**: surfaces the `base` flag on edits.
  - **`@be-music/player`** / **`@be-music/audio-renderer`**:
    honour the chart's `base` when resolving WAV / BMP slot
    IDs at playback time, so `#WAVaA` and `#WAVAA` map to
    distinct samples on a `#BASE 62` chart.
  - **`@be-music/utils`** / **`@be-music/json`**: shared
    helpers (`normalizeAsciiBase62Code`, `parseObjectKey`
    base parameter) the layers above call into.

  Charts that don't declare `#BASE 62` keep the historical
  36-base behaviour; the flag is opt-in.

- 632f274: Engine-side gameplay improvements:

  - **Landmine notes** — apply the chart-encoded damage value
    (default 4) on a manual mine hit; play `#WAV00` as the
    explosion sample so users get audible feedback consistent
    with LR2's mine semantics.
  - **空 POOR (empty POOR)** — fire the LR2-compatible "phantom
    press" verdict when the player presses a lane key with no
    note in window. Drains the gauge per gauge type without
    breaking combo or scoring, and triggers the POOR BGA
    swap window — matching real LR2 behaviour.
  - **Lanczos image resize option** — opt-in resampling for
    `#STAGEFILE` / `#BANNER` / `#BACKBMP` so high-res chart
    graphics down-scale cleanly to skin slot sizes instead of
    using the default nearest-neighbour path.
  - **Gradual TUI note height option** — render notes that
    span multiple terminal rows as a vertically-tweened
    gradient rather than a hard-edged block, so close note
    pairs read as distinct rather than fused.

- 632f274: Split the CLI / TUI frontend out of `@be-music/player` into a
  new `@be-music/player-tui` package.

  `@be-music/player` is now a pure playback-engine library:
  gameplay loop, scoring, lane layout, BGA timeline, signals,
  and the audio sink. Its package surface adds new subpath
  exports under `core/` (`bga-timeline`, `lane-layout`,
  `ui-options`) plus top-level `audio-sink`,
  `image-resize-algorithm`, `state-signals`, and `utils`. The
  `bms-player` bin and the Node-only dependencies (`libav.js`,
  `fast-bmp`, `fast-png`, `jpeg-js`) move to player-tui.

  `@be-music/player-tui` carries the `bms-player` bin, the
  terminal UI (kitty-graphics renderer, lane-stacking layout,
  high-speed control), Node worker runtimes, manual input,
  BGA video decoding, and the `keyboard-diagnostic` /
  `gameplay-input-diagnostic` entry points. Hosts that want
  just the engine (web players, custom UIs) depend on
  `@be-music/player`; the historical TUI experience lives in
  `@be-music/player-tui`.

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

- 632f274: - Carry the BMS `#BANNER` into the chart-selection prompt so
  the TUI's per-chart banner cell renders the correct image
  for the highlighted entry instead of falling back to the
  song-level `#STAGEFILE`.
  - Resume cleanly after a `Space` pause that overlaps a `#STOP`
    segment. Previously the playhead would freeze for the rest
    of the stop's duration on resume because the stop-clock
    baseline wasn't being rolled forward across the pause.
- Updated dependencies [632f274]
- Updated dependencies [135f822]
- Updated dependencies [135f822]
  - @be-music/parser@0.2.0
  - @be-music/chart@0.2.0
  - @be-music/audio-renderer@0.2.0
  - @be-music/json@0.2.0
  - @be-music/utils@0.2.0

## 0.1.0

### Minor Changes

- Initial release.

### Patch Changes

- Updated dependencies
  - @be-music/audio-renderer@0.1.0
  - @be-music/chart@0.1.0
  - @be-music/json@0.1.0
  - @be-music/parser@0.1.0
  - @be-music/utils@0.1.0
