# @be-music/utils

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

- 135f822: Split the Node-facing CLI / logging / PCM helpers out of the
  `@be-music/utils` package root into narrow subpath exports so
  browser bundles can import only the helpers they need without
  routing through code that pulls in `node:fs/promises` /
  `node:path` / etc.

  New subpaths (each emits its own dist entry; `package.json`
  `exports` map and `tsdown.config.ts` are updated accordingly):

  - `@be-music/utils/cli-path` — `resolveCliPath` (CLI argument →
    absolute path resolution, with POSIX / Windows-drive absolute
    fast paths and a Node-only `node:path` slow path for parent
    traversal).
  - `@be-music/utils/log` — file logger / no-op logger /
    `LogEntry` / `Logger` types.
  - `@be-music/utils/pcm` — `writeStereoPcm16Le` and the
    surrounding PCM helpers.

  The package root (`@be-music/utils`) still re-exports each subpath
  for backward compatibility, so existing callers keep working. New
  callers in CLI tools and TUI runtimes have been migrated to the
  subpaths to keep their module graphs tight.

### Patch Changes

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

## 0.1.0

### Minor Changes

- Initial release.
