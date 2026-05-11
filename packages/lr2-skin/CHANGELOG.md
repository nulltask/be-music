# @be-music/lr2-skin

## 0.1.2

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
  - @be-music/chart@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [632f274]
- Updated dependencies [135f822]
- Updated dependencies [135f822]
  - @be-music/chart@0.2.0
  - @be-music/json@0.2.0
  - @be-music/utils@0.2.0

## 0.1.0

### Minor Changes

- Initial renderer-independent LR2 skin parser package.

### Patch Changes

- Updated dependencies
  - @be-music/json@0.1.0
  - @be-music/utils@0.1.0
