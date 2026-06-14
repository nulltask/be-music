# @be-music/json

## 0.2.2

### Patch Changes

- b9922cf: Support the beatoraja bmson long-note type extensions: `info.ln_type` and per-note `t` (1: LN, 2: CN, 3: HCN) are preserved in the IR, round-trip through JSON and bmson output, and drive the player's long-note mode (per-note `t` wins over `info.ln_type`). Charts that specify neither now default to LN (no tail release judgment, matching the LR2-aligned BMS default) instead of always being treated as CN.
- Updated dependencies [ca1012c]
  - @be-music/utils@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [73dff9a]
  - @be-music/utils@0.2.1

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

### Patch Changes

- Updated dependencies [632f274]
- Updated dependencies [135f822]
- Updated dependencies [135f822]
  - @be-music/utils@0.2.0

## 0.1.0

### Minor Changes

- Initial release.

### Patch Changes

- Updated dependencies
  - @be-music/utils@0.1.0
