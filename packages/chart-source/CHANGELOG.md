# @be-music/chart-source

## 0.6.0

### Minor Changes

- ceb5fcc: Preserve the beatoraja bmson up field on source notes and events so LN end keysounds survive document and JSON round trips.
- 410843c: Represent bmson pre-play title artwork separately from loading and background images with titleImage metadata.
- c6f70f4: Represent bmson BGA sequences and conditional event metadata, and deep-clone sequence frames and image-set arrays so edits do not mutate the source chart. `BmsonBGAEvent.id` is now optional so an `id_set`-only event keeps its omitted id.
- c3b783a: Retain opaque bmson node annotations with independently cloned JSON fields, channel ownership and barline metadata. Export helpers for finite JSON copying and scope-specific reserved-key filtering. A value nested deeper than 256 levels is dropped like any other invalid annotation.
- 3e1855e: Add optional resources.wavGain for intrinsic per-slot linear gain, retaining exact composed audio levels through independent chart clones without changing older JSON defaults.
- 07a8c75: Retain complete ordered chart option declarations in optional `bms.options` and mark whole-file OPTION programs in control flow. Deep cloning owns the declaration list; the legacy last-value alias remains available.

### Patch Changes

- Updated dependencies: `@be-music/shared-utils@0.7.0`

## 0.5.0

### Minor Changes

- 69df53c: Add optional bmson IR source-audio slice coordinates, explicit TOTAL units and resource-key normalization beyond two characters for mixed NONSTOP courses. BMS token normalization remains unchanged.
- 29e69c6: Add `bms.wavNameBytePrefixes` to the chart JSON: the leading bytes of each `#WAV` file name as the file wrote them, by which LR2 groups a chart's sounds for EXTRA MODE and SP TO DP.

### Patch Changes

- Updated dependencies: `@be-music/shared-utils@0.6.0`

## 0.4.0

### Minor Changes

- dca9a2f: Rename the package from `@be-music/json` to `@be-music/chart-source` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies: `@be-music/shared-utils@0.5.0`

## 0.3.0

### Minor Changes

- b2818d0: Use canonical uppercase abbreviations in Be-Music types, helpers and JSON keys, including `BeMusicJSON`, `BMSResources`, `createEmptyJSON`, `cloneJSON`, `backBMP`, `initBPM`, `baseBPM`, `exWAV` and `poorBGA`. External BMS and bmson spellings remain unchanged.
  
  - Model bmson mine channels and scroll events, preserving authored scroll events during cloning.
  - Mark control-flow headers overridden by a later top-level definition with `overriddenByLaterHeader`.
  - Avoid allocating replacement strings for already-normalized channels and object keys.
  
  Migration: update consumers of the former type, helper and JSON key spellings. Deprecated long-note and damage fields on hidden-note entries are not interpreted as mines.

### Patch Changes

- Updated dependencies: `@be-music/shared-utils@0.4.0`
## 0.2.2

### Patch Changes

- b9922cf: The IR preserves beatoraja bmson long-note type extensions: `info.ln_type` and per-note `t` (1: LN, 2: CN, 3: HCN).
- Updated dependencies: `@be-music/shared-utils@0.3.0`

## 0.2.1

### Patch Changes

- Updated dependencies: `@be-music/shared-utils@0.2.1`

## 0.2.0

### Minor Changes

- 632f274: `parseObjectKey` accepts a base parameter so `#BASE 62` object IDs (`0-9A-Za-z`) round-trip without dropping casing. Charts that don't declare `#BASE 62` keep the historical 36-base behaviour.

### Patch Changes

- Updated dependencies: `@be-music/shared-utils@0.2.0`

## 0.1.0

### Minor Changes

- Initial release.

### Patch Changes

- Updated dependencies: `@be-music/shared-utils@0.1.0`
