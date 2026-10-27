# @be-music/skin-lr2

## 0.4.0

### Minor Changes

- 582ad35: Add optional per-side judgments to LR2 play frames and expose the judgment display conditions used by colored lasers. Preserve the first destination row's controls so later zeroes do not restart intro animations, and prefer the matching SP/DP layout when a key mode is unavailable.
- 7ab40af: Support resource-slot inheritance for IMAGE/LR2FONT CONTINUE and indexed HD/FHD resolution declarations. Correct the 14KEY/9KEY skin type mapping, honor the selected skin’s key-mode conditions, and resolve standalone theme assets by their longest matching directory suffix so same-named Play and Result textures or fonts are not confused.
- 85f13dc: Expose the stage-failure sound through `systemSounds.playStop`, resolving sound-set `#STOP` paths with the stock `playstop` fallback.
- b506535: LR2's judge timing on the select panel: button 74 (`LR2_BUTTON.JUDGE_TIMING`) steps it by 1 ms within ±99 (`stepLR2JudgeTiming`, `LR2_JUDGE_TIMING_LIMIT_MS`), button 75 (`LR2_BUTTON.JUDGE_AUTO_ADJUST`) cycles OFF, ON and SILENT (`LR2_JUDGE_TIMING_AUTO_ADJUST_CYCLE`) and draws that cell, text 80 labels the setting instead of always reading OFF, and number 12 shows the judge timing on the select screen and, from the frame's `judgeTimingMs`, during play instead of 0 (#777).
- 3d2bc84: Render an externally selected EX-HARD gauge with the red survival presentation and a valid original sprite cell.
  
  Use the original EASY sprite cell and normal gauge presentation for externally selected ASSIST EASY.
  
  Show LR2 BATTLE on LR2 skins: the select screen's BATTLE button and label, the 2P player's numbers, ranks, gauge ranges and groove gauge, the battle and EXTRA MODE ops, key-mode ops that follow the source chart, and the BATTLE play skins (`#INFORMATION` types 12 and 13).
- 77d8ec1: Support LR2's RANDOM MIX select buttons 260-266 and texts 190-196: `resolveLR2CourseMakerAction` maps the buttons to a `random-mix` action, `resolveLR2RandomMixButtonState` draws them at the value they edit, and `resolveLR2RandomMixText` / `formatLR2RandomMixSetting` write the settings as LR2 does (`OFF`, `NO LIMIT`, `LEVEL n`, `+- nBPM`, `n BPM`, `RANDOM`, `n STAGE`). A RANDOM MIX bar draws bar body 9, falling back to the course body.
- 3ffc4f8: Light REPLAY PLAYING (op 84) instead of REPLAY OFF (op 82) on the play screen of a replay (`LR2PlaySetup.replay`) and on the result of one (`PlayResult.fromReplay`), as LR2 keeps its replay status on through the results.
- affc51c: `resolveLR2PlayTimers` takes a `seek` moment: it stops the timers the judgments and the lanes started (gauge rise and full gauge, judgements, full combo, the bomb, long-note hold, key-on and key-off banks) and keeps the scene's, running the full-gauge timer again when the gauge is full at the second sought, so a play screen sought to another second no longer shows the judge plates, bombs and lane beams of the old position.

### Patch Changes

- a83e326: Use the renamed That-Which-Must-Not-Be-Named rank helpers when resolving play and result skin state.
- Updated dependencies [ba3cc20]
- Updated dependencies [7fca9a9]
- Updated dependencies [a9cc3d7]
- Updated dependencies [a83e326]
- Updated dependencies [69df53c]
- Updated dependencies [f994ec4]
- Updated dependencies [c52d77d]
- Updated dependencies [69df53c]
- Updated dependencies [29e69c6]
- Updated dependencies [3a5d9c3]
- Updated dependencies [3a5d9c3]
- Updated dependencies [fcaef41]
- Updated dependencies [7f0386b]
- Updated dependencies [45aff53]
- Updated dependencies [1c97afd]
- Updated dependencies [d08fdf9]
- Updated dependencies [a83e326]
- Updated dependencies [69df53c]
- Updated dependencies [78faa63]
- Updated dependencies [3d5e880]
- Updated dependencies [21f705d]
- Updated dependencies [a8896a9]
- Updated dependencies [b1ca2ce]
- Updated dependencies [6e676fe]
- Updated dependencies [aeac0d3]
- Updated dependencies [9f41b30]
- Updated dependencies [f994ec4]
- Updated dependencies [4371c72]
- Updated dependencies [acba3d5]
- Updated dependencies [3e694df]
- Updated dependencies [3e694df]
- Updated dependencies [c35b845]
- Updated dependencies [a83e326]
- Updated dependencies [a8896a9]
- Updated dependencies [85f13dc]
- Updated dependencies [3c2ea6b]
- Updated dependencies [aeac0d3]
- Updated dependencies [b09a6cf]
- Updated dependencies [85e11f7]
- Updated dependencies [d0939cc]
- Updated dependencies [3e694df]
- Updated dependencies [85250d8]
- Updated dependencies [2e435b9]
  - @be-music/player-engine@0.11.0
  - @be-music/chart-model@0.7.0
  - @be-music/chart-source@0.5.0
  - @be-music/player-scene-model@0.3.0
  - @be-music/shared-utils@0.6.0

## 0.3.0

### Minor Changes

- 9a0c3f9: Rename the play-skin chart description to `LR2PlaySkinChart` and consume canonical chart, replay, and judgment models. Keep LR2 format identifiers and skin operation values unchanged.
  
  Rename the package from `@be-music/lr2-skin` to `@be-music/skin-lr2` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies [dca9a2f]
- Updated dependencies [dca9a2f]
- Updated dependencies [9a0c3f9]
- Updated dependencies [9a0c3f9]
- Updated dependencies [dca9a2f]
  - @be-music/chart-model@0.6.0
  - @be-music/chart-source@0.4.0
  - @be-music/player-engine@0.10.0
  - @be-music/player-scene-model@0.2.0
  - @be-music/shared-utils@0.5.0

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
  
  LR2 never shipped a keyboard-mode skin, so `pickLr2PlaySkin` now maps the `'24'` / `'48'` chart variants onto the SP / DP That-Which-Must-Not-Be-Named fallback chains (`play_7` first for 24 keys, `play_14` first for 48). The mounted skin supplies the frame, gauge, and judge graphics while the 24 lanes themselves render through the host's fallback playfield.
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
