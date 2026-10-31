# @be-music/player-terminal

## 0.9.0

### Minor Changes

- afc65fb: Display generic bmson note columns and input labels with normal white-key styling, including storage channels otherwise used for scratch and FREE ZONE. Preserve F1–F24 press, repeat and release across kitty functional encodings and Win32 input mode.
- 5992a52: Apply exact chart-authored HI-SPEED to terminal note spacing and readouts. Extend `resolveVisibleBeatsForTUIGrid` with authored mode, preserving the full native range while keeping user-mode limits unchanged.
- cae8368: Render engine-driven bmson BGA sequence frames through ANSI and Kitty, loading all referenced alternatives and preserving source alpha, frame clocks and authored sequence lifetimes beyond the ordinary POOR window. Forward NONSTOP program sidecars through Node workers and apply FIT movie clocks to stage-owned resources.
- 3f3de70: Add --bmson-total-mode spec to disable recovery for bmson percentage TOTAL 0 while preserving the existing default.
- d869b05: Apply EXBMP transparent-color keys to opaque video frames before cropping and resizing. Preserve unselected black pixels and native borders across base, both overlays, POOR and implicit BMP00, including later streaming frames and resize/seek cache changes.
- dcb4256: Apply independent BGA opacity channels `0B`–`0E` to base, both overlays and POOR in ANSI and Kitty output. Blend over lower layers or the black canvas, refresh static-image caches on opacity changes, and restore the correct state after seeking or resizing. Allow renderer callers to supply precomputed opacity timelines.
- 4324783: Render engine-selected SWBGA frames in ANSI and Kitty output, including BMP00, placed aliases, EXBMP resources and keyed video frames. Accept optional input-bound frame state in the renderer, preserve normal BGA resources and restore the underlying planes after release or expiry.
- 458b6f3: Accept host-remapped NONSTOP SWBGA selections in the BGA loader and carry them through Node UI workers. Render stage frames with the FIT source-video rate and restore normal BGA when the animation ends.
- b14b94b: Renderer source frames accept optional per-pixel alpha coverage. Semi-transparent PNG and encoded-alpha BMP BGA pixels now blend with lower planes instead of becoming opaque or disappearing. Preserve source coverage through EXBMP keying, sub-region crops, nearest/Lanczos scaling and worker transfers, combine it with plane opacity and tint, and flatten the final result against the BGA background for ANSI and Kitty. Filter associated RGB during resizing to avoid transparent-color fringes. A 32-bit BMP whose alpha bytes are all zero stays opaque, as browsers decode it.

### Patch Changes

- b33db20: Load bmson BGA header filenames for base, layer and POOR images and videos instead of looking them up as BMS BMP slots.
- 274133e: Display chart text in a dedicated terminal row, clearing replaced selections and preventing embedded control characters from changing the screen layout.
  
  Forward structured NONSTOP text programs through gameplay-worker play options; the terminal displays the engine’s selected stage text.
- 460823d: Carry host-compiled NONSTOP option diagnostics through gameplay-worker options alongside the effective display program, retaining stage and source-time provenance.
- 4480fe0: Keep long sub-region source ids in internal mixed-NONSTOP bmson charts instead of truncating them to a different resource.
- 5c820d9: Apply channel-scoped BGA RGB multipliers and shared alpha controls in ANSI and Kitty output. Include color changes in render caches and preserve the source frame through POOR composition, resizing and backward seeks.
- de8a8d3: Render `#BGAxx` sub-region cues on base, both overlays and POOR instead of displaying missing-resource frames. Crop original image/video coordinates before fitting the BMS canvas, preserve authored placement and transparency, and apply the crop to streamed video frames without shifting coordinates through automatic black-border removal.
- 4b09c06: Apply EXBMP transparent-color keys to native still-image pixels before resizing and sub-region cropping. Preserve unkeyed black pixels, distinguish encoded alpha from inserted RGBA bytes and separate caches for different keys of the same image, including implicit POOR and stitched resources. Expand indexed PNG palettes, packed grayscale and encoded PNG transparency before keying.
- 8586109: Load BGA images declared only through `#EXBMPxx`, including the implicit POOR image in slot `00`, instead of displaying a missing-resource frame. Preserve explicit `#BMPxx` filenames when both declarations exist.
- ca29ca8: Keep image pixel buffers intact when worker conversion fails, so fallback BGA conversion displays the original colors instead of a black image.
- 27dba16: Decode BGA codecs supported by the bundled LibAV build, including HEVC and VP9/WebM, instead of rejecting every codec except MPEG-1, H.264 and MJPEG. Stop the loading pass after its first converted frame.
- Updated dependencies: `@be-music/chart-model@0.8.0`, `@be-music/player-engine@0.12.0`, `@be-music/chart-parser@0.6.0`, `@be-music/chart-audio-renderer@0.5.0`, `@be-music/chart-source@0.6.0`, `@be-music/player-node-audio@0.2.1`, `@be-music/shared-utils@0.7.0`

## 0.8.0

### Minor Changes

- 8a8364d: Add `--no-end-on-failure`, which keeps judging to the end of the chart after a survival gauge empties instead of ending the play there, for practice.

### Patch Changes

- a83e326: Use `____` for the That-Which-Must-Not-Be-Named ruleset CLI argument and `????` in replay comparison reports.
- f994ec4: Honor POOR BGA overlay and hidden modes in ANSI and Kitty rendering. Preserve PNG transparency for overlays and keep the normal BGA cache intact when POOR display is disabled.
- Updated dependencies: `@be-music/player-engine@0.11.0`, `@be-music/chart-audio-renderer@0.4.1`, `@be-music/chart-model@0.7.0`, `@be-music/chart-parser@0.5.0`, `@be-music/chart-source@0.5.0`, `@be-music/player-node-audio@0.2.0`, `@be-music/shared-utils@0.6.0`

## 0.7.0

### Minor Changes

- 9a0c3f9: Rename the replay inspection command to `bms-replay` and the recording APIs and modules to replay terminology. Adopt canonical chart and judgment types; the previous command and API spellings are removed.
  
  Rename the package from `@be-music/player-tui` to `@be-music/player-terminal` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies: `@be-music/chart-audio-renderer@0.4.0`, `@be-music/chart-model@0.6.0`, `@be-music/chart-parser@0.4.0`, `@be-music/chart-source@0.4.0`, `@be-music/player-engine@0.10.0`, `@be-music/shared-utils@0.5.0`

## 0.6.0

### Minor Changes

- b2818d0: Keep terminal playback, audio previews and chart summaries consistent with the shared chart and player rules.
  
  - Resolve RANDOM/SWITCH outcomes once for both rendered audio and playback.
  - Use the shared lane-mode and scored-note rules, including PMS, FREE ZONE and keyboard modes.
  - Draw scroll gimmicks and negative-BPM reversal consistently, and keep BMP00 as the POOR image unless POORBGA is 2.
  - Preserve detected key-release capabilities across plays in the same terminal process.
  
  Migration: use canonical uppercase-abbreviation TUI and BGA API names.

### Patch Changes

- Updated dependencies: `@be-music/chart-audio-renderer@0.3.0`, `@be-music/chart-model@0.5.0`, `@be-music/chart-source@0.3.0`, `@be-music/chart-parser@0.3.0`, `@be-music/player-engine@0.9.0`, `@be-music/shared-utils@0.4.0`
## 0.5.1

### Patch Changes

- 63bea3f: Fix `bms-playlog` rejecting `--` with "unknown option '--'", which broke `pnpm playlog -- <file>`. `--` now ends the options, and every argument after it is read as a file.
- Updated dependencies: `@be-music/player-engine@0.8.0`

## 0.5.0

### Minor Changes

- 3ff2f57: Add `--ruleset` and `--gauge` to `bms-player`.
  
  `--ruleset <lr2|beatoraja|____>` picks the compat ruleset the engine judges under (default `lr2`) and
  `--gauge <GROOVE|EASY|HARD|DEATH>` picks the gauge (default `GROOVE`, mapped onto each ruleset's own line-up).
  Unknown values are rejected with the list of accepted ones rather than silently falling back. The TUI result block
  prints the SCORE line only for rulesets that define a money score, and now also prints the empty-POOR count.

### Patch Changes

- b3fa635: Shorten the default POOR / miss BGA display window from 2000 ms to 500 ms, matching real LR2.
  
  LR2 ships `<poorbga>500</poorbga>` in its `config.xml` and its changelog documents 500 ms as the
  miss-BGA default, so the previous 2-second window held the miss layer four times longer than LR2.
  `DEFAULT_POOR_BGA_DISPLAY_SECONDS` is shared by the TUI compositor and the web LR2 scene, so both
  runtimes pick up the corrected timing.
- Updated dependencies: `@be-music/chart-model@0.4.0`, `@be-music/player-engine@0.7.0`, `@be-music/chart-audio-renderer@0.2.4`, `@be-music/chart-parser@0.2.4`

## 0.4.0

### Minor Changes

- ab210cb: Add the `bms-playlog` CLI: reads recorded play-log files (`*.bmplay.json`) and re-derives LR2 / beatoraja / That-Which-Must-Not-Be-Named judgments, EX-SCORE, DJ LEVEL, max combo, money score, and groove gauge from the raw input replay, printing a per-ruleset comparison table (or `--json`).

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.6.0`

## 0.3.0

### Minor Changes

- ca1012c: Make the TUI player work as a Node single executable application (SEA).

  - Gameplay, UI, and BGA-video workers are now spawned from an embedded copy of the SEA bundle (eval workers dispatched by the new `sea-main` entry on a workerData role marker); previously the worker URL resolution threw under SEA and playback silently never started.
  - The CLI entry refuses to start from a worker thread, since inside SEA workers `process.argv[1]` still equals `process.execPath`.
  - `@uwx/libav.js-fat` (video BGA) loads through the SEA-aware optional-module loader, so a `node_modules` directory next to the executable now works.
  - SEA binaries embed `node-web-audio-api` (with its dependency closure, filtered to the target platform's native addon) and `@uwx/libav.js-fat` (filtered to the wasm build actually used at runtime), extracting them once into `~/.be-music/sea-embedded-modules` at startup, so audio playback and video BGA work out of the box; a `node_modules` directory next to the executable still takes precedence.

### Patch Changes

- Updated dependencies: `@be-music/chart-parser@0.2.3`, `@be-music/chart-source@0.2.2`, `@be-music/player-engine@0.5.0`, `@be-music/chart-audio-renderer@0.2.3`, `@be-music/shared-utils@0.3.0`, `@be-music/chart-model@0.3.2`

## 0.2.6

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.4.3`

## 0.2.5

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.4.2`

## 0.2.4

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.4.1`, `@be-music/shared-utils@0.2.1`, `@be-music/chart-audio-renderer@0.2.2`, `@be-music/chart-source@0.2.1`, `@be-music/chart-parser@0.2.2`, `@be-music/chart-model@0.3.1`

## 0.2.3

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.3.0`, `@be-music/player-engine@0.4.0`, `@be-music/chart-audio-renderer@0.2.1`, `@be-music/chart-parser@0.2.1`

## 0.2.2

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.3.1`

## 0.2.1

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.3.0`

## 0.2.0

### Minor Changes

- 632f274: Initial release of the CLI / TUI frontend split out of `@be-music/player-engine`.

  `@be-music/player-terminal` carries the `bms-player` bin, the terminal UI (kitty-graphics renderer, lane-stacking layout, high-speed control), Node worker runtimes, manual input, BGA video decoding, and the `keyboard-diagnostic` / `gameplay-input-diagnostic` entry points.

  Gradual TUI note height is opt-in: notes that span multiple terminal rows render as a vertically-tweened gradient rather than a hard-edged block, so close note pairs read as distinct.

### Patch Changes

- 632f274: Carry the BMS `#BANNER` into the chart-selection prompt so the TUI's per-chart banner cell renders the highlighted entry's image instead of falling back to the song-level `#STAGEFILE`.
- 135f822: TUI input and verdict-plate fixes:

  - Absolute-path arguments now resolve correctly under pure-ESM Node runtimes (`tsx`, `node --import tsx/esm`); the previous `resolveCliPath` slow path silently fell back to `cwd`.
  - POOR / BAD verdict plates no longer pair with the running combo number (would otherwise display `POOR 5` after EMPTY POOR preserves combo).
  - In-play key input is no longer swallowed in the TUI worker-thread engine — `pressedAt` is wall-clock-ms-based so the main-thread input runtime and the worker-thread engine share a comparable clock domain.

- Updated dependencies: `@be-music/chart-parser@0.2.0`, `@be-music/chart-model@0.2.0`, `@be-music/player-engine@0.2.0`, `@be-music/chart-audio-renderer@0.2.0`, `@be-music/chart-source@0.2.0`, `@be-music/shared-utils@0.2.0`

## 0.1.0

### Minor Changes

- Initial release.

### Patch Changes

- Updated dependencies: `@be-music/chart-audio-renderer@0.1.0`, `@be-music/chart-model@0.1.0`, `@be-music/chart-source@0.1.0`, `@be-music/chart-parser@0.1.0`, `@be-music/shared-utils@0.1.0`
