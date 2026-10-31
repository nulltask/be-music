# @be-music/chart-writer

## 0.6.0

### Minor Changes

- ceb5fcc: Write bmson up flags and per-note long-note types through preserved and canonical output, including edits. Omit playable end-sound entries during lossy BMS conversion instead of creating extra taps.
- 0984e30: Carry ordinary BGA across format conversions instead of dropping it. `stringifyBmson` writes a BMS chart's `#BMPxx` images and `04` / `07` / `06` cues as bmson header and base / layer / POOR events (with `#BMP00` as the initial POOR image), and `stringifyBMS` writes a bmson chart's header and events as `#BMPxx` resources and `04` / `07` / `06` objects. A new `onDiagnostic` option on both reports what the target format cannot represent (layer2 cues, BMS BGA extensions, bmson sequences and conditional layers, layer black transparency, `#POORBGA 1`) instead of losing it silently.
- c6f70f4: Round-trip bmson BGA sequences and event id_set, condition and interval fields, including edited values and canonical output. An event whose source omitted `id` is written without one.
- c3b783a: Re-emit opaque bmson annotations on preserved and canonical output, following edited nodes and independent channel slots. Filter reserved keys and invalidate stale annotations after edits.

### Patch Changes

- 410843c: Keep bmson title_image in both preserved and canonical output so title artwork survives round trips.
- 4e4b0c3: Changing bmson output resolution no longer shortens long notes or moves BGA cues. Scale absolute LN endpoints, every BGA event plane and default-resolution barlines consistently; retain millisecond sequence timings and explicit empty barlines. Reject a pulse grid that would turn a positive LN into a tap.
- e66f84f: Preserve long bmson resource keys in canonical output and reject BMS export explicitly when two-character IDs cannot represent the chart.
- 86f4978: Preserve the effective HDX LONGMODE as ln_type when converting a BMS chart to bmson.
- 3e1855e: Preserve representable intrinsic slot gain as integer WAVCMD volume in BMS output. Reject lossy percentage conversion and unsupported bmson gain explicitly, including when preservation validation is skipped.
- 07a8c75: Write every chart option declaration in order and preserve conditional OPTION programs without duplicating unconditional values. Detect edits to earlier declarations when validating preserved source.
- afc65fb: Keep authored generic bmson lane positions in canonical output, including sparse and second-bank keys. Retain consecutive numbering for synthesized generic BMS conversions and reject BMS export that cannot preserve an explicit generic keyboard.
- Updated dependencies: `@be-music/chart-model@0.8.0`, `@be-music/chart-parser@0.6.0`, `@be-music/chart-source@0.6.0`, `@be-music/shared-utils@0.7.0`

## 0.5.1

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.7.0`, `@be-music/chart-parser@0.5.0`, `@be-music/chart-source@0.5.0`, `@be-music/shared-utils@0.6.0`

## 0.5.0

### Minor Changes

- dca9a2f: Rename the package from `@be-music/stringifier` to `@be-music/chart-writer` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.6.0`, `@be-music/chart-parser@0.4.0`, `@be-music/chart-source@0.4.0`, `@be-music/shared-utils@0.5.0`

## 0.4.0

### Minor Changes

- b2818d0: Preserve chart meaning when writing BMS and bmson.
  
  - Write bmson keyboard-mode and scroll-event extensions.
  - Preserve long notes, mines, hidden notes and their lane mappings when converting formats.
  - Write BPM/STOP timing, judge rank, TOTAL and resolution-scaled bar lines in the target format's units.
  - Omit branch headers overridden by later top-level definitions so regenerated files retain their effective values.
  
  Migration: use `stringifyBMS`, `BMSStringifyOptions` and the canonical Be-Music JSON keys. External BMS directives and bmson keys retain their specified spellings.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.5.0`, `@be-music/chart-source@0.3.0`, `@be-music/chart-parser@0.3.0`, `@be-music/shared-utils@0.4.0`
## 0.3.3

### Patch Changes

- f4dc1c3: Fix `stringifyBms` dropping `#WAVCMD` lines: when an edited chart's header is rewritten, every line in `bms.wavCmds` is now written instead of only the first one.
- 5fcba7b: Fix `stringifyBmson` writing mines as ordinary notes: landmine events (`Dx` / `Ex`) now go to bmson `key_channels` on the lane they sit on and keep their `damage`, instead of landing in `sound_channels` as extra playable lanes.

## 0.3.2

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.4.0`, `@be-music/chart-parser@0.2.4`

## 0.3.1

### Patch Changes

- b9922cf: Round-trip beatoraja bmson long-note type extensions (`info.ln_type` and per-note `t`) through JSON and bmson output.
- Updated dependencies: `@be-music/chart-parser@0.2.3`, `@be-music/chart-source@0.2.2`, `@be-music/shared-utils@0.3.0`, `@be-music/chart-model@0.3.2`

## 0.3.0

### Minor Changes

- 69f77d1: Add an opt-in `skipPreservationValidation` flag to `stringifyBmsJson` that bypasses the round-trip re-parse + canonical fallback. In-process pipelines that can guarantee the preservation arrays match the JSON (tests, SHA-stable exports) save a parse + diff pass per call. Default behaviour (validate + fallback) is unchanged.

### Patch Changes

- Updated dependencies: `@be-music/shared-utils@0.2.1`, `@be-music/chart-source@0.2.1`, `@be-music/chart-parser@0.2.2`, `@be-music/chart-model@0.3.1`

## 0.2.1

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.3.0`, `@be-music/chart-parser@0.2.1`

## 0.2.0

### Minor Changes

- 632f274: Thread the chart's `#BASE 62` object-ID base through stringify so serialised charts round-trip without dropping casing. Charts that don't declare `#BASE 62` keep the historical 36-base behaviour.

### Patch Changes

- Updated dependencies: `@be-music/chart-parser@0.2.0`, `@be-music/chart-model@0.2.0`, `@be-music/chart-source@0.2.0`, `@be-music/shared-utils@0.2.0`

## 0.1.0

### Minor Changes

- Initial release.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.1.0`, `@be-music/chart-source@0.1.0`, `@be-music/chart-parser@0.1.0`, `@be-music/shared-utils@0.1.0`
