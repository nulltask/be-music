# @be-music/chart-audio-renderer

## 0.4.1

### Patch Changes

- 69df53c: Render stitched bmson audio using retained source-slice coordinates and resource identifiers longer than two characters.
- Updated dependencies [a83e326]
- Updated dependencies [69df53c]
- Updated dependencies [f994ec4]
- Updated dependencies [c52d77d]
- Updated dependencies [69df53c]
- Updated dependencies [29e69c6]
- Updated dependencies [69df53c]
- Updated dependencies [29e69c6]
- Updated dependencies [2e435b9]
  - @be-music/chart-model@0.7.0
  - @be-music/chart-parser@0.5.0
  - @be-music/chart-source@0.5.0
  - @be-music/shared-utils@0.6.0

## 0.4.0

### Minor Changes

- dca9a2f: Rename the package from `@be-music/audio-renderer` to `@be-music/chart-audio-renderer` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies [dca9a2f]
- Updated dependencies [dca9a2f]
- Updated dependencies [dca9a2f]
- Updated dependencies [dca9a2f]
  - @be-music/chart-model@0.6.0
  - @be-music/chart-parser@0.4.0
  - @be-music/chart-source@0.4.0
  - @be-music/shared-utils@0.5.0

## 0.3.0

### Minor Changes

- b2818d0: Render chart audio using the shared chart timing and sample-trigger rules, including parent-folder keysound lookup, valid #VOLWAV ranges and LR2 negative-BPM reversal behavior. Update ogg-opus-decoder to 1.7.5.
  
  Migration: use `renderJSON` and the uppercase-abbreviation API names. Import timing resolvers, sample-trigger helpers and their types from `@be-music/chart-model`; the renderer root exports rendering APIs only, and `@be-music/chart-audio-renderer/triggers` is removed.

### Patch Changes

- Updated dependencies [b2818d0]
  - @be-music/chart-model@0.5.0
  - @be-music/chart-source@0.3.0
  - @be-music/chart-parser@0.3.0
  - @be-music/shared-utils@0.4.0
## 0.2.4

### Patch Changes

- Updated dependencies [202a28b]
  - @be-music/chart-model@0.4.0
  - @be-music/chart-parser@0.2.4

## 0.2.3

### Patch Changes

- 6ce9173: Missing, undefined, or undecodable `#WAVxx` references are now silent by default, matching LR2 / beatoraja. The synthesized sine fallback tone is opt-in via `fallbackToneSeconds`.
- Updated dependencies [b2c4f9b]
- Updated dependencies [b9922cf]
- Updated dependencies [4d5a89e]
- Updated dependencies [cdc42a1]
- Updated dependencies [ca1012c]
  - @be-music/chart-parser@0.2.3
  - @be-music/chart-source@0.2.2
  - @be-music/shared-utils@0.3.0
  - @be-music/chart-model@0.3.2

## 0.2.2

### Patch Changes

- Updated dependencies [73dff9a]
  - @be-music/shared-utils@0.2.1
  - @be-music/chart-source@0.2.1
  - @be-music/chart-parser@0.2.2
  - @be-music/chart-model@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [06a2db9]
  - @be-music/chart-model@0.3.0
  - @be-music/chart-parser@0.2.1

## 0.2.0

### Minor Changes

- 632f274: Honour the chart's `#BASE 62` object-ID base when resolving WAV / BMP slot IDs at playback time, so `#WAVaA` and `#WAVAA` map to distinct samples. Charts that don't declare `#BASE 62` keep the historical 36-base behaviour.

### Patch Changes

- Updated dependencies [632f274]
- Updated dependencies [135f822]
- Updated dependencies [135f822]
  - @be-music/chart-parser@0.2.0
  - @be-music/chart-model@0.2.0
  - @be-music/chart-source@0.2.0
  - @be-music/shared-utils@0.2.0

## 0.1.0

### Minor Changes

- Initial release.

### Patch Changes

- Updated dependencies
  - @be-music/chart-model@0.1.0
  - @be-music/chart-source@0.1.0
  - @be-music/chart-parser@0.1.0
  - @be-music/shared-utils@0.1.0
