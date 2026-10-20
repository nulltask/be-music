# @be-music/skin-lr2

## 0.2.0

### Minor Changes

- b2818d0: Provide `@be-music/skin-lr2/ids` and `@be-music/skin-lr2/state` for named LR2 skin vocabulary and deterministic scene-state resolution.
  
  - Resolve screen options, numbers, text, sliders, graphs, buttons and timers from shared select, decide, play, result and course models.
  - Load course-screen definitions and theme system sounds.
  - Select keyboard-mode skin fallbacks using bmson's mode hint, including charts that use only a subset of keyboard lanes.
  
  Migration: use canonical names such as `LR2Skin` and `LR2BGAElement`. LR2 CSV commands retain their specification spellings.

### Patch Changes

- Updated dependencies [b2818d0]
  - @be-music/chart-model@0.5.0
  - @be-music/chart-source@0.3.0
  - @be-music/player-engine@0.9.0
  - @be-music/player-scene-model@0.1.0
  - @be-music/shared-utils@0.4.0
## 0.1.6

### Patch Changes

- 202a28b: Pick a play skin for 24-key charts instead of returning nothing.
  
  LR2 never shipped a keyboard-mode skin, so `pickLr2PlaySkin` now maps the `'24'` / `'48'` chart variants onto the SP / DP IIDX fallback chains (`play_7` first for 24 keys, `play_14` first for 48). The mounted skin supplies the frame, gauge, and judge graphics while the 24 lanes themselves render through the host's fallback playfield.
- Updated dependencies [202a28b]
  - @be-music/chart-model@0.4.0

## 0.1.5

### Patch Changes

- Emit declaration-compatible types for the public `LR2_PLAY_VARIANTS` and path-table constants so consumers building under `isolatedDeclarations` no longer fail on the inferred `as const satisfies ...` types.

## 0.1.4

### Patch Changes

- Updated dependencies [b9922cf]
- Updated dependencies [ca1012c]
  - @be-music/chart-source@0.2.2
  - @be-music/shared-utils@0.3.0
  - @be-music/chart-model@0.3.2

## 0.1.3

### Patch Changes

- 69f77d1: `autoDetectCanvasFromObservedCoordinates` now uses a two-stage rule when picking a design canvas for `#RESOLUTION`-less themes:

  1. **High inclusion (≥ 90 %)** — the candidate covers nearly all DST corners, so it's the design canvas. Handles cleanly-authored skins.
  2. **Plateau** — the candidate already contains a non-trivial fraction (> 30 %) AND the next bigger tier adds little (< 10 % of total corners). The remaining uncaught corners are far-off slide-animation keyframes the next tier doesn't catch either, so the current tier is the right design canvas.

  Fixes the LR2 default `decide.lr2skin` regression where slide-out keyframes flying elements off the right side dragged the detected canvas up to 1920×1080 and shrunk the on-screen chrome into the top-left quadrant.

- 69f77d1: Cache a `BasenameIndex` per source map (WeakMap-keyed) bucketed by lowercase basename, with parent / grandparent path slices precomputed so `resolveLr2IncludePath` / `resolveLr2AssetBytes`'s suffix-match comparisons don't re-lower on every call. The LR2 default theme ships hundreds of files; the previous `[...sourceFiles.keys()].find(...)` pattern dominated theme load + every per-frame `#CUSTOMFILE` resolve.
- Updated dependencies [73dff9a]
  - @be-music/shared-utils@0.2.1
  - @be-music/chart-source@0.2.1
  - @be-music/chart-model@0.3.1

## 0.1.2

### Patch Changes

- Updated dependencies [06a2db9]
  - @be-music/chart-model@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [632f274]
- Updated dependencies [135f822]
- Updated dependencies [135f822]
  - @be-music/chart-model@0.2.0
  - @be-music/chart-source@0.2.0
  - @be-music/shared-utils@0.2.0

## 0.1.0

### Minor Changes

- Initial renderer-independent LR2 skin parser package.

### Patch Changes

- Updated dependencies
  - @be-music/chart-source@0.1.0
  - @be-music/shared-utils@0.1.0
