# @be-music/json

## 0.3.0

### Minor Changes

- b2818d0: Use canonical uppercase abbreviations in Be-Music types, helpers and JSON keys, including `BeMusicJSON`, `BMSResources`, `createEmptyJSON`, `cloneJSON`, `backBMP`, `initBPM`, `baseBPM`, `exWAV` and `poorBGA`. External BMS and bmson spellings remain unchanged.
  
  - Model bmson mine channels and scroll events, preserving authored scroll events during cloning.
  - Mark control-flow headers overridden by a later top-level definition with `overriddenByLaterHeader`.
  - Avoid allocating replacement strings for already-normalized channels and object keys.
  
  Migration: update consumers of the former type, helper and JSON key spellings. Deprecated long-note and damage fields on hidden-note entries are not interpreted as mines.

### Patch Changes

- Updated dependencies [b2818d0]
  - @be-music/utils@0.4.0
## 0.2.2

### Patch Changes

- b9922cf: The IR preserves beatoraja bmson long-note type extensions: `info.ln_type` and per-note `t` (1: LN, 2: CN, 3: HCN).
- Updated dependencies [ca1012c]
  - @be-music/utils@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [73dff9a]
  - @be-music/utils@0.2.1

## 0.2.0

### Minor Changes

- 632f274: `parseObjectKey` accepts a base parameter so `#BASE 62` object IDs (`0-9A-Za-z`) round-trip without dropping casing. Charts that don't declare `#BASE 62` keep the historical 36-base behaviour.

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
