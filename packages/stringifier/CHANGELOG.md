# @be-music/stringifier

## 0.4.0

### Minor Changes

- b2818d0: Preserve chart meaning when writing BMS and bmson.
  
  - Write bmson keyboard-mode and scroll-event extensions.
  - Preserve long notes, mines, hidden notes and their lane mappings when converting formats.
  - Write BPM/STOP timing, judge rank, TOTAL and resolution-scaled bar lines in the target format's units.
  - Omit branch headers overridden by later top-level definitions so regenerated files retain their effective values.
  
  Migration: use `stringifyBMS`, `BMSStringifyOptions` and the canonical Be-Music JSON keys. External BMS directives and bmson keys retain their specified spellings.

### Patch Changes

- Updated dependencies [b2818d0]
  - @be-music/chart@0.5.0
  - @be-music/json@0.3.0
  - @be-music/parser@0.3.0
  - @be-music/utils@0.4.0
## 0.3.3

### Patch Changes

- f4dc1c3: Fix `stringifyBms` dropping `#WAVCMD` lines: when an edited chart's header is rewritten, every line in `bms.wavCmds` is now written instead of only the first one.
- 5fcba7b: Fix `stringifyBmson` writing mines as ordinary notes: landmine events (`Dx` / `Ex`) now go to bmson `key_channels` on the lane they sit on and keep their `damage`, instead of landing in `sound_channels` as extra playable lanes.

## 0.3.2

### Patch Changes

- Updated dependencies [202a28b]
  - @be-music/chart@0.4.0
  - @be-music/parser@0.2.4

## 0.3.1

### Patch Changes

- b9922cf: Round-trip beatoraja bmson long-note type extensions (`info.ln_type` and per-note `t`) through JSON and bmson output.
- Updated dependencies [b2c4f9b]
- Updated dependencies [b9922cf]
- Updated dependencies [4d5a89e]
- Updated dependencies [cdc42a1]
- Updated dependencies [ca1012c]
  - @be-music/parser@0.2.3
  - @be-music/json@0.2.2
  - @be-music/utils@0.3.0
  - @be-music/chart@0.3.2

## 0.3.0

### Minor Changes

- 69f77d1: Add an opt-in `skipPreservationValidation` flag to `stringifyBmsJson` that bypasses the round-trip re-parse + canonical fallback. In-process pipelines that can guarantee the preservation arrays match the JSON (tests, SHA-stable exports) save a parse + diff pass per call. Default behaviour (validate + fallback) is unchanged.

### Patch Changes

- Updated dependencies [73dff9a]
  - @be-music/utils@0.2.1
  - @be-music/json@0.2.1
  - @be-music/parser@0.2.2
  - @be-music/chart@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [06a2db9]
  - @be-music/chart@0.3.0
  - @be-music/parser@0.2.1

## 0.2.0

### Minor Changes

- 632f274: Thread the chart's `#BASE 62` object-ID base through stringify so serialised charts round-trip without dropping casing. Charts that don't declare `#BASE 62` keep the historical 36-base behaviour.

### Patch Changes

- Updated dependencies [632f274]
- Updated dependencies [135f822]
- Updated dependencies [135f822]
  - @be-music/parser@0.2.0
  - @be-music/chart@0.2.0
  - @be-music/json@0.2.0
  - @be-music/utils@0.2.0

## 0.1.0

### Minor Changes

- Initial release.

### Patch Changes

- Updated dependencies
  - @be-music/chart@0.1.0
  - @be-music/json@0.1.0
  - @be-music/parser@0.1.0
  - @be-music/utils@0.1.0
