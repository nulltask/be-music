# @be-music/lr2-skin

## 0.1.5

### Patch Changes

- Emit declaration-compatible types for the public `LR2_PLAY_VARIANTS` and path-table constants so consumers building under `isolatedDeclarations` no longer fail on the inferred `as const satisfies ...` types.

## 0.1.4

### Patch Changes

- Updated dependencies [b9922cf]
- Updated dependencies [ca1012c]
  - @be-music/json@0.2.2
  - @be-music/utils@0.3.0
  - @be-music/chart@0.3.2

## 0.1.3

### Patch Changes

- 69f77d1: `autoDetectCanvasFromObservedCoordinates` now uses a two-stage rule when picking a design canvas for `#RESOLUTION`-less themes:

  1. **High inclusion (≥ 90 %)** — the candidate covers nearly all DST corners, so it's the design canvas. Handles cleanly-authored skins.
  2. **Plateau** — the candidate already contains a non-trivial fraction (> 30 %) AND the next bigger tier adds little (< 10 % of total corners). The remaining uncaught corners are far-off slide-animation keyframes the next tier doesn't catch either, so the current tier is the right design canvas.

  Fixes the LR2 default `decide.lr2skin` regression where slide-out keyframes flying elements off the right side dragged the detected canvas up to 1920×1080 and shrunk the on-screen chrome into the top-left quadrant.

- 69f77d1: Cache a `BasenameIndex` per source map (WeakMap-keyed) bucketed by lowercase basename, with parent / grandparent path slices precomputed so `resolveLr2IncludePath` / `resolveLr2AssetBytes`'s suffix-match comparisons don't re-lower on every call. The LR2 default theme ships hundreds of files; the previous `[...sourceFiles.keys()].find(...)` pattern dominated theme load + every per-frame `#CUSTOMFILE` resolve.
- Updated dependencies [73dff9a]
  - @be-music/utils@0.2.1
  - @be-music/json@0.2.1
  - @be-music/chart@0.3.1

## 0.1.2

### Patch Changes

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
