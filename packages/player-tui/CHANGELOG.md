# @be-music/player-tui

## 0.4.0

### Minor Changes

- ab210cb: Add the `bms-playlog` CLI: reads recorded play-log files (`*.bmplay.json`) and re-derives LR2 / beatoraja / IIDX judgments, EX-SCORE, DJ LEVEL, max combo, money score, and groove gauge from the raw input replay, printing a per-ruleset comparison table (or `--json`).

### Patch Changes

- Updated dependencies
- Updated dependencies [ab210cb]
  - @be-music/player@0.6.0

## 0.3.0

### Minor Changes

- ca1012c: Make the TUI player work as a Node single executable application (SEA).

  - Gameplay, UI, and BGA-video workers are now spawned from an embedded copy of the SEA bundle (eval workers dispatched by the new `sea-main` entry on a workerData role marker); previously the worker URL resolution threw under SEA and playback silently never started.
  - The CLI entry refuses to start from a worker thread, since inside SEA workers `process.argv[1]` still equals `process.execPath`.
  - `@uwx/libav.js-fat` (video BGA) loads through the SEA-aware optional-module loader, so a `node_modules` directory next to the executable now works.
  - SEA binaries embed `node-web-audio-api` (with its dependency closure, filtered to the target platform's native addon) and `@uwx/libav.js-fat` (filtered to the wasm build actually used at runtime), extracting them once into `~/.be-music/sea-embedded-modules` at startup, so audio playback and video BGA work out of the box; a `node_modules` directory next to the executable still takes precedence.

### Patch Changes

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

## 0.2.6

### Patch Changes

- Updated dependencies [9b7f269]
  - @be-music/player@0.4.3

## 0.2.5

### Patch Changes

- Updated dependencies [eb92249]
  - @be-music/player@0.4.2

## 0.2.4

### Patch Changes

- Updated dependencies [69f77d1]
- Updated dependencies [956fd01]
- Updated dependencies [73dff9a]
  - @be-music/player@0.4.1
  - @be-music/utils@0.2.1
  - @be-music/audio-renderer@0.2.2
  - @be-music/json@0.2.1
  - @be-music/parser@0.2.2
  - @be-music/chart@0.3.1

## 0.2.3

### Patch Changes

- Updated dependencies [06a2db9]
  - @be-music/chart@0.3.0
  - @be-music/player@0.4.0
  - @be-music/audio-renderer@0.2.1
  - @be-music/parser@0.2.1

## 0.2.2

### Patch Changes

- Updated dependencies [b9a5f51]
  - @be-music/player@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [5ea9072]
  - @be-music/player@0.3.0

## 0.2.0

### Minor Changes

- 632f274: Initial release of the CLI / TUI frontend split out of `@be-music/player`.

  `@be-music/player-tui` carries the `bms-player` bin, the terminal UI (kitty-graphics renderer, lane-stacking layout, high-speed control), Node worker runtimes, manual input, BGA video decoding, and the `keyboard-diagnostic` / `gameplay-input-diagnostic` entry points.

  Gradual TUI note height is opt-in: notes that span multiple terminal rows render as a vertically-tweened gradient rather than a hard-edged block, so close note pairs read as distinct.

### Patch Changes

- 632f274: Carry the BMS `#BANNER` into the chart-selection prompt so the TUI's per-chart banner cell renders the highlighted entry's image instead of falling back to the song-level `#STAGEFILE`.
- 135f822: TUI input and verdict-plate fixes:

  - Absolute-path arguments now resolve correctly under pure-ESM Node runtimes (`tsx`, `node --import tsx/esm`); the previous `resolveCliPath` slow path silently fell back to `cwd`.
  - POOR / BAD verdict plates no longer pair with the running combo number (would otherwise display `POOR 5` after EMPTY POOR preserves combo).
  - In-play key input is no longer swallowed in the TUI worker-thread engine — `pressedAt` is wall-clock-ms-based so the main-thread input runtime and the worker-thread engine share a comparable clock domain.

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
